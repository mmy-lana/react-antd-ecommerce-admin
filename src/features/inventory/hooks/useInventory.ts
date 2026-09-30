/**
 * Reactive inventory reads (plan Task 4.1).
 *
 * `useLiveQuery` re-runs whenever IndexedDB signals a change, so every filter,
 * search box and analytics card on the inventory view stays in step with a stock
 * mutation without any manual invalidation.
 *
 * Archived products are excluded by default: `isArchived` is a boolean, which
 * IndexedDB cannot index, so the `deletedAt` ISO key carries the "still active"
 * test instead (an absent `deletedAt` means the product is live).
 *
 * The filtering, sorting and search rules live in exported pure functions so
 * they can be asserted without a database.
 */

import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../../../shared/db/dexieDb';
import { unitMargin } from '../../../shared/utils/stockStatus';
import type {
  CategoryFilter,
  InventoryLog,
  Product,
  ProductVariant,
  StockStatusFilter,
  UUID,
} from '../../../shared/types';

export const ALL_FILTER_VALUE = 'all' as const;

export type InventorySortKey = 'name' | 'category' | 'brand' | 'totalStock' | 'updatedAt' | 'status';

export interface InventoryFilters {
  category: CategoryFilter;
  stockStatus: StockStatusFilter;
  searchQuery: string;
  /** Archived products are hidden unless the view asks for them. */
  includeArchived?: boolean;
}

export type InventorySortDirection = 'asc' | 'desc';

export interface InventorySort {
  key: InventorySortKey;
  direction: InventorySortDirection;
}

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  category: ALL_FILTER_VALUE,
  stockStatus: ALL_FILTER_VALUE,
  searchQuery: '',
  includeArchived: false,
};

export const DEFAULT_INVENTORY_SORT: InventorySort = { key: 'name', direction: 'asc' };

/* -------------------------------------------------------------------------- */
/* Pure query helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every field a shopper would plausibly type. Variants are included so a search
 * for a size or colour finds the parent product.
 */
export const matchesProductSearch = (product: Product, rawQuery: string): boolean => {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return true;

  const haystack = [
    product.name,
    product.sku,
    product.brand,
    product.category,
    product.description,
    ...product.tags,
    ...product.variants.flatMap((variant) => [variant.name, variant.sku]),
  ]
    .join(' ')
    .toLowerCase();

  // Every whitespace-separated term must appear, so "blue shirt" narrows
  // rather than widens the result set.
  return query.split(/\s+/).every((term) => haystack.includes(term));
};

export const filterProducts = (
  products: readonly Product[],
  filters: InventoryFilters,
): Product[] => {
  const includeArchived = filters.includeArchived ?? false;

  return products.filter((product) => {
    if (!includeArchived && (product.isArchived || product.deletedAt !== undefined)) return false;
    if (filters.category !== ALL_FILTER_VALUE && product.category !== filters.category) return false;
    if (filters.stockStatus !== ALL_FILTER_VALUE && product.status !== filters.stockStatus) return false;
    return matchesProductSearch(product, filters.searchQuery);
  });
};

const compareByKey = (product: Product, key: InventorySortKey): number | string => {
  switch (key) {
    case 'name':
      return product.name.toLowerCase();
    case 'category':
      return product.category.toLowerCase();
    case 'brand':
      return product.brand.toLowerCase();
    case 'totalStock':
      return product.totalStock;
    case 'status':
      return product.status;
    case 'updatedAt':
      return product.updatedAt;
  }
};

export const sortProducts = (products: readonly Product[], sort: InventorySort): Product[] => {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...products].sort((left, right) => {
    const a = compareByKey(left, sort.key);
    const b = compareByKey(right, sort.key);
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
    return String(a).localeCompare(String(b)) * factor;
  });
};

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export interface InventoryAnalytics {
  totalProducts: number;
  totalUnits: number;
  stockValue: number;
  stockCost: number;
  marginValue: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  discontinuedCount: number;
  archivedCount: number;
  averageUnitsPerProduct: number;
}

export const buildInventoryAnalytics = (products: readonly Product[]): InventoryAnalytics => {
  let totalUnits = 0;
  let stockValue = 0;
  let stockCost = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let discontinuedCount = 0;

  for (const product of products) {
    totalUnits += Math.max(0, product.totalStock);
    const price = product.basePrice;
    const cost = product.baseCost;
    stockValue += Math.max(0, product.totalStock) * price;
    stockCost += Math.max(0, product.totalStock) * cost;
    if (product.status === 'in_stock') inStockCount += 1;
    else if (product.status === 'low_stock') lowStockCount += 1;
    else if (product.status === 'out_of_stock') outOfStockCount += 1;
    else if (product.status === 'discontinued') discontinuedCount += 1;
  }

  const marginValue = Math.round((stockValue - stockCost + Number.EPSILON) * 100) / 100;

  return {
    totalProducts: products.length,
    totalUnits,
    stockValue: Math.round(stockValue * 100) / 100,
    stockCost: Math.round(stockCost * 100) / 100,
    marginValue,
    inStockCount,
    lowStockCount,
    outOfStockCount,
    discontinuedCount,
    archivedCount: products.filter((product) => product.isArchived).length,
    averageUnitsPerProduct:
      products.length === 0 ? 0 : Math.round((totalUnits / products.length) * 100) / 100,
  };
};

/** The restock watchlist: the most urgent items first, ties broken by name. */
export const selectRestockWatchlist = (
  products: readonly Product[],
  limit: number = 6,
): Product[] =>
  products
    .filter((product) => !product.isArchived && (product.status === 'out_of_stock' || product.status === 'low_stock'))
    .sort((left, right) => {
      // How far below the safety line each product sits, deepest deficit first.
      const leftGap = left.totalStock - left.safetyStockThreshold;
      const rightGap = right.totalStock - right.safetyStockThreshold;
      if (leftGap !== rightGap) return leftGap - rightGap;
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);

/** The value at risk if every low-stock item were ordered to its safety line. */
export const calculateRestockCost = (products: readonly Product[]): number =>
  Math.round(
    products
      .filter((product) => !product.isArchived && (product.status === 'out_of_stock' || product.status === 'low_stock'))
      .reduce((total, product) => {
        const gap = Math.max(0, product.safetyStockThreshold - product.totalStock);
        return total + gap * product.baseCost;
      }, 0) * 100,
  ) / 100;

/** Every variant row across the catalogue, flattened for tables and exports. */
export interface FlatVariant extends ProductVariant {
  productName: string;
  productCategory: string;
  productId: UUID;
  margin: number;
}

export const flattenVariants = (products: readonly Product[]): FlatVariant[] =>
  products
    .filter((product) => !product.isArchived)
    .flatMap((product) =>
      product.variants
        .filter((variant) => !variant.isArchived)
        .map((variant) => ({
          ...variant,
          productId: product.id,
          productName: product.name,
          productCategory: product.category,
          margin: unitMargin(variant.price, variant.costPrice),
        })),
    );

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface InventoryQueryResult {
  products: Product[];
  filteredProducts: Product[];
  totalCount: number;
  analytics: InventoryAnalytics;
  watchlist: Product[];
  restockCost: number;
  loading: boolean;
  error: string | null;
}

export interface UseInventoryOptions {
  filters?: Partial<InventoryFilters>;
  sort?: InventorySort;
  /** Cap the watchlist; the view decides how much it can show. */
  watchlistLimit?: number;
}

/**
 * Live product list plus derived analytics.
 *
 * `products` is the archive-aware full set; `filteredProducts` additionally
 * applies the toolbar's category, status and search filters.
 */
export const useInventory = (options: UseInventoryOptions = {}): InventoryQueryResult => {
  const { filters, sort, watchlistLimit = 6 } = options;

  const resolvedFilters = useMemo<InventoryFilters>(
    () => ({ ...DEFAULT_INVENTORY_FILTERS, ...filters }),
    [
      filters?.category,
      filters?.stockStatus,
      filters?.searchQuery,
      filters?.includeArchived,
    ],
  );

  // `undefined` is the sentinel for "still loading": `useLiveQuery` returns the
  // default only before the first observation, never on a later re-render.
  const liveProducts = useLiveQuery<Product[]>(() => db.products.orderBy('name').toArray(), []);
  const loadError = useLiveQuery<string | null>(
    async () => {
      try {
        await db.products.count();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'The local database could not be read.';
      }
    },
    [],
  );

  const loading = liveProducts === undefined;
  const products = useMemo(() => liveProducts ?? [], [liveProducts]);

  const filteredProducts = useMemo(
    () => sortProducts(filterProducts(products, resolvedFilters), sort ?? DEFAULT_INVENTORY_SORT),
    [products, resolvedFilters, sort],
  );

  const analytics = useMemo(() => buildInventoryAnalytics(products), [products]);
  const watchlist = useMemo(
    () => selectRestockWatchlist(products, watchlistLimit),
    [products, watchlistLimit],
  );
  const restockCost = useMemo(() => calculateRestockCost(products), [products]);

  return {
    products,
    filteredProducts,
    totalCount: products.length,
    analytics,
    watchlist,
    restockCost,
    loading,
    error: loadError ?? null,
  };
};

/**
 * Recent ledger entries for a product, newest first.
 *
 * Kept as a separate hook so a drawer can load only the slice it displays.
 */
export const useProductInventoryLogs = (productId: UUID | null, limit: number = 20): InventoryLog[] => {
  const logs = useLiveQuery<InventoryLog[]>(
    async () => {
      if (productId === null) return [];
      const rows = await db.inventoryLogs.where('productId').equals(productId).toArray();
      return rows
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, limit);
    },
    [productId, limit],
  );

  return logs ?? [];
};

/**
 * Selection state for the batch action bar.
 *
 * Selection is kept as a `Set` so membership is a constant-time check while
 * the table renders hundreds of rows.
 */
export interface ProductSelection {
  selectedIds: ReadonlySet<UUID>;
  selectedCount: number;
  isSelected: (id: UUID) => boolean;
  toggle: (id: UUID) => void;
  selectMany: (ids: readonly UUID[]) => void;
  clear: () => void;
  /** Selection is meaningful only while something is actually selected. */
  hasSelection: boolean;
}

export const useProductSelection = (): ProductSelection => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<UUID>>(() => new Set<UUID>());

  const toggle = useCallback((id: UUID) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const selectMany = useCallback((ids: readonly UUID[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set<UUID>()), []);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    isSelected: useCallback((id: UUID) => selectedIds.has(id), [selectedIds]),
    toggle,
    selectMany,
    clear,
    hasSelection: selectedIds.size > 0,
  };
};
