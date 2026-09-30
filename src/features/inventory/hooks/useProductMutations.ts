/**
 * Product write mutations (plan Task 4.2).
 *
 * `mutateProductStock` is the single door through which stock ever changes.
 * Everything it must guarantee happens inside one IndexedDB transaction, so a
 * failure part-way through cannot leave a product, its variants and its audit
 * log disagreeing with each other:
 *
 *  1. read the product;
 *  2. apply the delta to the targeted variant, or spread it across the live
 *     variants when no variant is named;
 *  3. reject a negative result **before** writing, which rolls the transaction
 *     back;
 *  4. recompute `totalStock` from the non-archived variants;
 *  5. recompute `Product.status` through the shared resolver;
 *  6. append the matching `InventoryLog` row.
 *
 * The arithmetic lives in exported pure functions (`planStockChange`,
 * `recalculateTotalStock`, `buildInventoryLog`) so the rules can be asserted
 * without a database, and `applyStockChange` is the only part that touches
 * IndexedDB.
 */

import { useCallback, useMemo, useState } from 'react';

import { db } from '../../../shared/db/dexieDb';
import { nowIsoUtc } from '../../../shared/utils/dateMath';
import { resolveStockStatus } from '../../../shared/utils/stockStatus';
import {
  INVENTORY_CHANGE_TYPES,
  type InventoryChangeType,
  type InventoryLog,
  type InventoryScope,
  type Product,
  type ProductVariant,
  type StockStatus,
  type UUID,
} from '../../../shared/types';

/** Who the ledger records as responsible. */
export const DEFAULT_ACTOR = 'admin@local';

export interface StockChangeRequest {
  productId: UUID;
  /** Omit to adjust the product-level balance rather than one variant. */
  variantId?: UUID;
  changeType: InventoryChangeType;
  /**
   * Signed for `adjustment`; a magnitude for every other change type, whose
   * direction is derived from the type itself.
   */
  quantity: number;
  reason: string;
  performedBy?: string;
  at?: string;
}

export interface StockChangeResult {
  product: Product;
  log: InventoryLog;
  previousQuantity: number;
  newQuantity: number;
}

export type ChangeDirection = 'increase' | 'decrease' | 'signed';

/**
 * Direction per change type.
 *
 * `damage` reduces stock like a sale does; treating it as an increase was a
 * real defect caught by the render harness in phase 3.
 */
export const CHANGE_DIRECTION: Record<InventoryChangeType, ChangeDirection> = {
  restock: 'increase',
  return: 'increase',
  sale: 'decrease',
  damage: 'decrease',
  adjustment: 'signed',
};

export const resolveChangeDirection = (changeType: InventoryChangeType): ChangeDirection =>
  CHANGE_DIRECTION[changeType];

/** Turns a submitted quantity into a signed delta. */
export const resolveSignedDelta = (changeType: InventoryChangeType, quantity: number): number => {
  if (!Number.isFinite(quantity)) return 0;
  switch (CHANGE_DIRECTION[changeType]) {
    case 'increase':
      return Math.abs(Math.trunc(quantity));
    case 'decrease':
      return -Math.abs(Math.trunc(quantity));
    case 'signed':
      return Math.trunc(quantity);
  }
};

export type StockMutationErrorCode =
  | 'not_found'
  | 'invalid_quantity'
  | 'negative_stock'
  | 'archived'
  | 'unknown_change_type';

/** Raised by the mutation path; the message is written for display. */
export class StockMutationError extends Error {
  readonly code: StockMutationErrorCode;

  constructor(code: StockMutationErrorCode, message: string) {
    super(message);
    this.name = 'StockMutationError';
    this.code = code;
  }
}

export const isStockMutationError = (cause: unknown): cause is StockMutationError =>
  cause instanceof StockMutationError;

/* -------------------------------------------------------------------------- */
/* Pure arithmetic                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Raw sum of the live variants, deliberately **unclamped**.
 *
 * The negative-stock guard reads this value. Clamping here would make an
 * oversell look like a legitimate zero and let it through, so the clamp lives
 * in {@link recalculateTotalStock}, which only ever produces a value to store.
 */
export const sumVariantStock = (variants: readonly ProductVariant[]): number =>
  variants
    .filter((variant) => !variant.isArchived)
    .reduce((total, variant) => total + Math.trunc(variant.stockQuantity), 0);

/** Sums the variants that still participate in stock accounting, floored at zero. */
export const recalculateTotalStock = (variants: readonly ProductVariant[]): number =>
  Math.max(0, sumVariantStock(variants));

/**
 * Spreads a signed delta evenly across the live variants, giving any remainder
 * to the first few. The sum of the result equals `delta` exactly, which is what
 * keeps `totalStock` consistent with the variant rows.
 */
export const applyDeltaAcrossVariants = (
  variants: readonly ProductVariant[],
  signedDelta: number,
  at: string,
): ProductVariant[] => {
  const liveIndexes = variants.reduce<number[]>((indexes, variant, index) => {
    if (!variant.isArchived) indexes.push(index);
    return indexes;
  }, []);

  if (liveIndexes.length === 0 || signedDelta === 0) {
    return variants.map((variant) => ({ ...variant }));
  }

  const share = Math.trunc(signedDelta / liveIndexes.length);
  const remainder = signedDelta - share * liveIndexes.length;
  const remainderMagnitude = Math.abs(remainder);
  const remainderSign = Math.sign(remainder);

  return variants.map((variant, index) => {
    const liveIndex = liveIndexes.indexOf(index);
    if (liveIndex === -1) return { ...variant };
    const extra = liveIndex < remainderMagnitude ? remainderSign : 0;
    return {
      ...variant,
      stockQuantity: Math.max(0, Math.trunc(variant.stockQuantity) + share + extra),
      updatedAt: at,
    };
  });
};

export interface StockChangePlan {
  product: Product;
  previousQuantity: number;
  newQuantity: number;
  signedDelta: number;
  scope: InventoryScope;
}

/**
 * Applies a change to a product and returns the row that should be stored.
 *
 * Throws *before* producing a value if the change would drive stock negative, so
 * a caller can never persist a half-applied result.
 */
export const planStockChange = (
  product: Product,
  request: StockChangeRequest,
): StockChangePlan => {
  const { changeType, quantity, variantId } = request;

  if (!INVENTORY_CHANGE_TYPES.includes(changeType)) {
    throw new StockMutationError(
      'unknown_change_type',
      `“${String(changeType)}” is not an inventory change type.`,
    );
  }
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new StockMutationError(
      'invalid_quantity',
      'A stock change must be a non-zero whole number of units.',
    );
  }

  const at = request.at ?? nowIsoUtc();
  const signedDelta = resolveSignedDelta(changeType, quantity);
  const scope: InventoryScope = variantId === undefined ? 'product' : 'variant';

  let variants: ProductVariant[];
  let previousQuantity: number;

  if (variantId === undefined) {
    previousQuantity = recalculateTotalStock(product.variants);
    variants = applyDeltaAcrossVariants(product.variants, signedDelta, at);
  } else {
    const index = product.variants.findIndex((variant) => variant.id === variantId);
    if (index === -1) {
      throw new StockMutationError('not_found', `That variant is not part of ${product.name}.`);
    }
    const target = product.variants[index];
    if (target === undefined || target.isArchived) {
      throw new StockMutationError('archived', `That variant is archived and can no longer be adjusted.`);
    }
    previousQuantity = Math.max(0, Math.trunc(target.stockQuantity));
    variants = product.variants.map((variant, position) =>
      position === index
        ? { ...variant, stockQuantity: previousQuantity + signedDelta, updatedAt: at }
        : { ...variant },
    );
  }

  // Guarded on the unclamped sum: clamping first would turn an oversell into a
  // legal zero balance.
  const rawTotal = sumVariantStock(variants);
  if (rawTotal < 0) {
    throw new StockMutationError(
      'negative_stock',
      scope === 'variant' && variantId !== undefined
        ? `${product.name} · ${product.variants.find((variant) => variant.id === variantId)?.name ?? 'variant'} only has ${previousQuantity} units available; this change would leave stock negative.`
        : `${product.name} only has ${previousQuantity} units available; this change would leave stock negative.`,
    );
  }

  const totalStock = Math.max(0, rawTotal);
  const newQuantity = totalStock;

  return {
    product: {
      ...product,
      variants,
      totalStock,
      status: resolveStockStatus({
        totalStock,
        safetyStockThreshold: product.safetyStockThreshold,
        variants,
        status: product.status,
      }),
      updatedAt: at,
    },
    previousQuantity,
    newQuantity,
    signedDelta: newQuantity - previousQuantity,
    scope,
  };
};

/** Builds the ledger row that accompanies a change. */
export const buildInventoryLog = (
  productId: UUID,
  request: StockChangeRequest,
  plan: Pick<StockChangePlan, 'previousQuantity' | 'newQuantity' | 'scope'>,
  at: string,
): InventoryLog => ({
  id: crypto.randomUUID(),
  productId,
  ...(request.variantId === undefined ? {} : { variantId: request.variantId }),
  scope: plan.scope,
  changeType: request.changeType,
  quantityDelta: plan.newQuantity - plan.previousQuantity,
  previousQuantity: plan.previousQuantity,
  newQuantity: plan.newQuantity,
  reason: request.reason.trim(),
  performedBy: request.performedBy ?? DEFAULT_ACTOR,
  timestamp: at,
});

/* -------------------------------------------------------------------------- */
/* Transactional writes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The one write path for stock.
 *
 * Products and ledger rows move together; rejecting the change throws before
 * anything is written, and any failure inside the transaction rolls the whole
 * thing back.
 */
export const applyStockChange = async (request: StockChangeRequest): Promise<StockChangeResult> => {
  const at = request.at ?? nowIsoUtc();

  return db.transaction('rw', db.products, db.inventoryLogs, async () => {
    const product = await db.products.get(request.productId);
    if (product === undefined) {
      throw new StockMutationError('not_found', 'That product no longer exists.');
    }

    const plan = planStockChange(product, { ...request, at });
    const log = buildInventoryLog(product.id, request, plan, at);

    await db.products.put(plan.product);
    await db.inventoryLogs.add(log);

    return {
      product: plan.product,
      log,
      previousQuantity: plan.previousQuantity,
      newQuantity: plan.newQuantity,
    };
  });
};

/**
 * Applies one stock change to each product **atomically**.
 *
 * The batch operation this replaces looped over `applyStockChange`, giving each
 * product its own transaction. That is not a batch: if the ninth of twenty
 * products failed validation, the first eight were already committed and the
 * ledger was left describing a restock the user never completed, with nothing
 * recording which half succeeded.
 *
 * Dexie joins a nested transaction to its parent whenever the table scope is
 * compatible, so the inner `applyStockChange` calls below do *not* open their
 * own transactions — they participate in this one. Any throw aborts all of them,
 * and a successful return means every product moved and every ledger row landed.
 *
 * Requests apply in the order given, which is what makes two requests against
 * the same product behave sensibly: each sees the previous one's write.
 */
export const applyBatchStockChange = async (
  requests: readonly StockChangeRequest[],
): Promise<StockChangeResult[]> =>
  db.transaction('rw', db.products, db.inventoryLogs, async () => {
    const results: StockChangeResult[] = [];
    for (const request of requests) {
      results.push(await applyStockChange(request));
    }
    return results;
  });

export interface ProductVariantDraft {
  id?: UUID;
  name: string;
  sku: string;
  price: number;
  costPrice: number;
  stockQuantity: number;
  safetyStockThreshold: number;
}

export interface ProductDraft {
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  basePrice: number;
  baseCost: number;
  safetyStockThreshold: number;
  status: StockStatus;
  tags: string[];
  variants: ProductVariantDraft[];
}

const buildVariants = (drafts: readonly ProductVariantDraft[], at: string): ProductVariant[] =>
  drafts.map((draft) => ({
    id: draft.id ?? crypto.randomUUID(),
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    price: Math.max(0, draft.price),
    costPrice: Math.max(0, draft.costPrice),
    stockQuantity: Math.max(0, Math.trunc(draft.stockQuantity)),
    safetyStockThreshold: Math.max(0, Math.trunc(draft.safetyStockThreshold)),
    attributes: {},
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  }));

/** Materialises a draft into a storable product, deriving every denormalised field. */
export const buildProductFromDraft = (draft: ProductDraft, at: string = nowIsoUtc()): Product => {
  const variants = buildVariants(draft.variants, at);
  const totalStock = recalculateTotalStock(variants);

  return {
    id: crypto.randomUUID(),
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    category: draft.category,
    brand: draft.brand,
    description: draft.description,
    basePrice: Math.max(0, draft.basePrice),
    baseCost: Math.max(0, draft.baseCost),
    totalStock,
    safetyStockThreshold: Math.max(0, Math.trunc(draft.safetyStockThreshold)),
    status: resolveStockStatus({
      totalStock,
      safetyStockThreshold: draft.safetyStockThreshold,
      variants,
      status: draft.status,
    }),
    variants,
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  };
};

/** Applies an edit while preserving the product's identity and creation time. */
export const applyProductDraft = (
  existing: Product,
  draft: ProductDraft,
  at: string = nowIsoUtc(),
): Product => {
  const rebuilt = buildProductFromDraft(draft, at);

  // Variants that already existed keep their id and creation time; removed ones
  // are archived rather than deleted, so historical ledger rows stay resolvable.
  const variants = rebuilt.variants.map((variant, index) => {
    const previous =
      existing.variants.find((candidate) => candidate.id === variant.id) ??
      existing.variants[index];
    return previous === undefined
      ? variant
      : { ...variant, id: previous.id, createdAt: previous.createdAt };
  });

  const totalStock = recalculateTotalStock(variants);
  const status: StockStatus =
    existing.status === 'discontinued'
      ? 'discontinued'
      : resolveStockStatus({
          totalStock,
          safetyStockThreshold: rebuilt.safetyStockThreshold,
          variants,
          status: draft.status,
        });

  return {
    ...rebuilt,
    id: existing.id,
    variants,
    totalStock,
    status,
    isArchived: existing.isArchived,
    ...(existing.deletedAt === undefined ? {} : { deletedAt: existing.deletedAt }),
    createdAt: existing.createdAt,
    updatedAt: at,
  };
};

export const createProduct = async (draft: ProductDraft): Promise<Product> => {
  const product = buildProductFromDraft(draft);
  await db.products.add(product);
  return product;
};

export const updateProduct = async (productId: UUID, draft: ProductDraft): Promise<Product> =>
  db.transaction('rw', db.products, async () => {
    const existing = await db.products.get(productId);
    if (existing === undefined) {
      throw new StockMutationError('not_found', 'That product no longer exists.');
    }
    const next = applyProductDraft(existing, draft);
    await db.products.put(next);
    return next;
  });

/** Soft delete: the row stays for audit, but leaves every default query. */
export const archiveProduct = async (productId: UUID, at: string = nowIsoUtc()): Promise<Product> =>
  db.transaction('rw', db.products, async () => {
    const existing = await db.products.get(productId);
    if (existing === undefined) {
      throw new StockMutationError('not_found', 'That product no longer exists.');
    }
    const next: Product = { ...existing, isArchived: true, deletedAt: at, updatedAt: at };
    await db.products.put(next);
    return next;
  });

export const restoreProduct = async (productId: UUID, at: string = nowIsoUtc()): Promise<Product> =>
  db.transaction('rw', db.products, async () => {
    const existing = await db.products.get(productId);
    if (existing === undefined) {
      throw new StockMutationError('not_found', 'That product no longer exists.');
    }
    const { deletedAt: _archivedAt, ...restored } = existing;
    const next: Product = { ...restored, isArchived: false, updatedAt: at };
    await db.products.put(next);
    return next;
  });

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Archives every product in a single transaction — all of them, or none.
 *
 * Same all-or-nothing contract as {@link applyBatchStockChange}: a soft delete
 * that half-succeeds would hide some products from the catalogue while the
 * user believed the whole selection was archived.
 */
export const archiveProducts = async (
  productIds: readonly UUID[],
  at: string = nowIsoUtc(),
): Promise<Product[]> =>
  db.transaction('rw', db.products, async () => {
    const archived: Product[] = [];
    for (const productId of productIds) {
      archived.push(await archiveProduct(productId, at));
    }
    return archived;
  });

/* -------------------------------------------------------------------------- */
/* Product create / update / archive                                           */
/* -------------------------------------------------------------------------- */

export interface ProductMutations {
  mutateProductStock: (request: StockChangeRequest) => Promise<StockChangeResult>;
  /** All-or-nothing across every request; one failure aborts the whole batch. */
  batchProductStock: (requests: readonly StockChangeRequest[]) => Promise<StockChangeResult[]>;
  createProduct: (draft: ProductDraft) => Promise<Product>;
  updateProduct: (productId: UUID, draft: ProductDraft) => Promise<Product>;
  archiveProduct: (productId: UUID) => Promise<Product>;
  /** All-or-nothing across every id. */
  archiveProducts: (productIds: readonly UUID[]) => Promise<Product[]>;
  restoreProduct: (productId: UUID) => Promise<Product>;
  pending: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Wraps the write helpers in pending/error state for the views.
 *
 * The helpers stay callable directly so a transaction can be composed without
 * the hook — for example when returning stock for a cancelled order.
 */
export const useProductMutations = (): ProductMutations => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setPending(true);
    setError(null);
    try {
      return await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
      throw cause;
    } finally {
      setPending(false);
    }
  }, []);

  return useMemo<ProductMutations>(
    () => ({
      mutateProductStock: (request) => run(() => applyStockChange(request)),
      batchProductStock: (requests) => run(() => applyBatchStockChange(requests)),
      createProduct: (draft) => run(() => createProduct(draft)),
      updateProduct: (productId, draft) => run(() => updateProduct(productId, draft)),
      archiveProduct: (productId) => run(() => archiveProduct(productId)),
      archiveProducts: (productIds) => run(() => archiveProducts(productIds)),
      restoreProduct: (productId) => run(() => restoreProduct(productId)),
      pending,
      error,
      clearError: () => setError(null),
    }),
    [run, pending, error],
  );
};
