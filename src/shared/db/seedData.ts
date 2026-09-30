/**
 * Deterministic seed dataset for the local IndexedDB store.
 *
 * The generator is seeded from a fixed constant and every timestamp is anchored
 * to "now" at call time, so a fresh browser always opens onto a populated,
 * internally consistent demo workspace: 30 multi-variant products, 100 historical
 * orders spread across the trailing year, and a stock ledger whose running
 * balances reconcile exactly with the quantities stored on each product.
 *
 * Determinism matters because the ledger, the product totals and the order
 * history all have to agree — a random fixture set would drift and make the
 * inventory audit views look broken.
 */

import type { Dayjs } from 'dayjs';

import { db } from './dexieDb';
import type {
  CustomerSummary,
  InventoryChangeType,
  InventoryLog,
  InventoryScope,
  ISODateString,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Product,
  ProductBrand,
  ProductCategory,
  ProductVariant,
  ShippingCountry,
  UUID,
} from '../types';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  SHIPPING_COUNTRIES,
  SYSTEM_OPERATOR_NAME,
} from '../types';
import { roundToCents } from '../utils/currency';
import { nowIsoUtc, toIsoUtcString, toUtcDayjs } from '../utils/dateMath';
import { activeVariants, resolveStockStatus } from '../utils/stockStatus';

/* -------------------------------------------------------------------------- */
/* Seed configuration                                                         */
/* -------------------------------------------------------------------------- */

export const SEED_PRODUCT_COUNT = 30;
export const SEED_ORDER_COUNT = 100;
export const SEED_CUSTOMER_COUNT = 45;
export const SEED_TRAILING_DAYS = 365;
/** Fixed PRNG seed: the dataset is reproducible, only the "now" anchor moves. */
export const SEED_RANDOM_SEED = 0x5eed1a7e;

const TAX_RATE = 0.08;
const FREE_SHIPPING_THRESHOLD = 150;
const STANDARD_SHIPPING_FEE = 9.95;

/* -------------------------------------------------------------------------- */
/* Seeded pseudo-random number generator                                      */
/* -------------------------------------------------------------------------- */

interface SeededRandom {
  next: () => number;
  intBetween: (min: number, max: number) => number;
  floatBetween: (min: number, max: number, fractionDigits?: number) => number;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
  chance: (probability: number) => boolean;
}

/** mulberry32 — small, fast, and stable across engines. */
const createSeededRandom = (seed: number): SeededRandom => {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const intBetween = (min: number, max: number): number => {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) return low;
    return low + Math.floor(next() * (high - low + 1));
  };

  return {
    next,
    intBetween,
    floatBetween: (min, max, fractionDigits = 2) =>
      Number((min + next() * (max - min)).toFixed(fractionDigits)),
    pick: <T,>(items: readonly T[]): T => items[intBetween(0, items.length - 1)],
    weighted: <T,>(entries: readonly (readonly [T, number])[]): T => {
      if (entries.length === 0) {
        throw new RangeError('weighted() requires at least one candidate with a positive weight');
      }
      const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
      if (!(totalWeight > 0)) {
        throw new RangeError('weighted() requires a positive total weight');
      }
      let roll = next() * totalWeight;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    chance: (probability: number) => next() < probability,
  };
};

const HEX_DIGITS = '0123456789abcdef';

const toHexByte = (byte: number): string => HEX_DIGITS.charAt((byte >> 4) & 0x0f) + HEX_DIGITS.charAt(byte & 0x0f);

/** RFC 4122 shaped, version-4 tagged identifiers generated from the seed. */
const createUuidV4 = (rng: SeededRandom): UUID => {
  const bytes = Array.from({ length: 16 }, () => rng.intBetween(0, 255));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.map(toHexByte).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/* -------------------------------------------------------------------------- */
/* Reference catalogs                                                         */
/* -------------------------------------------------------------------------- */

const PRODUCT_MODELS: Record<ProductCategory, readonly string[]> = {
  Audio: [
    'Aurora Wireless Headphones',
    'Pulse Studio Earbuds',
    'Cascade Soundbar',
    'Nimbus Portable Speaker',
    'Halo Noise-Cancelling Buds',
  ],
  Computing: [
    'Meridian 14 Ultrabook',
    'Atlas Mechanical Keyboard',
    'Vertex USB-C Hub',
    'Helix Studio Display',
    'Quanta Mesh Router',
  ],
  'Mobile Accessories': [
    'Lumen MagSafe Stand',
    'Bolt 65W GaN Charger',
    'Prism Tempered Glass',
    'Orbit Braided Cable',
    'Beacon Power Bank',
  ],
  'Home & Kitchen': [
    'Copper Core Cookware Set',
    'Precision Electric Kettle',
    'Aero Blender',
    'Silence Range Hood',
    'Terra Coffee Grinder',
  ],
  Outdoor: [
    'Ridgeline 45L Pack',
    'Summit Trekking Poles',
    'Drift Camp Chair',
    'Beacon Trail Lantern',
    'Cascade Dry Bag',
  ],
  Wearables: [
    'Pulse Fitness Band',
    'Solstice Smartwatch',
    'Tempo Running Watch',
    'Lumen Smart Ring',
    'Apex Climbing Tracker',
  ],
};

const BRAND_CODES: Record<ProductBrand, string> = {
  Auralis: 'AUR',
  Northwind: 'NWD',
  Kestrel: 'KTR',
  Lumen: 'LMN',
  Vertex: 'VTX',
  Sable: 'SBL',
};

const CATEGORY_CODES: Record<ProductCategory, string> = {
  Audio: 'AU',
  Computing: 'CP',
  'Mobile Accessories': 'MA',
  'Home & Kitchen': 'HK',
  Outdoor: 'OD',
  Wearables: 'WR',
};

interface VariantAxis {
  code: string;
  label: string;
  values: readonly string[];
}

const VARIANT_AXES: Record<ProductCategory, readonly VariantAxis[]> = {
  Audio: [
    { code: 'C', label: 'Color', values: ['Midnight Black', 'Arctic White', 'Moss Green'] },
    { code: 'B', label: 'Battery', values: ['8-hour', '20-hour', '40-hour'] },
  ],
  Computing: [
    { code: 'S', label: 'Storage', values: ['256GB', '512GB', '1TB'] },
    { code: 'R', label: 'RAM', values: ['16GB', '32GB', '64GB'] },
  ],
  'Mobile Accessories': [
    { code: 'C', label: 'Color', values: ['Jet Black', 'Arctic White', 'Navy'] },
    { code: 'P', label: 'Pack', values: ['Single', 'Duo', 'Triple'] },
  ],
  'Home & Kitchen': [
    { code: 'V', label: 'Capacity', values: ['1L', '1.5L', '2L'] },
    { code: 'F', label: 'Finish', values: ['Matte Black', 'Brushed Steel'] },
  ],
  Outdoor: [
    { code: 'Z', label: 'Season', values: ['Summer', 'All-Season', 'Winter'] },
    { code: 'C', label: 'Color', values: ['Granite', 'Moss', 'Ember'] },
  ],
  Wearables: [
    { code: 'Z', label: 'Case Size', values: ['38mm', '42mm', '46mm'] },
    { code: 'B', label: 'Band', values: ['Sport Loop', 'Sport Band', 'Woven Solo'] },
  ],
};

const TAG_POOL: Record<ProductCategory, readonly string[]> = {
  Audio: ['anc', 'wireless', 'hifi', 'travel', 'gift'],
  Computing: ['pro', 'portable', 'usb-c', 'ergonomic', 'refurb'],
  'Mobile Accessories': ['fast-charge', 'magsafe', 'travel', 'durability', 'gift'],
  'Home & Kitchen': ['premium', 'compact', 'energy-efficient', 'gift', 'easy-clean'],
  Outdoor: ['ultralight', 'weatherproof', 'trail', 'camping', 'packable'],
  Wearables: ['gps', 'health', 'sleep', 'waterproof', 'recovery'],
};

const DESCRIPTION_OPENERS: Record<ProductCategory, readonly string[]> = {
  Audio: [
    'Engineered for lossless playback with adaptive noise cancellation and a 40-hour battery.',
    'Studio-grade tuning in a chassis light enough for an all-day commute.',
  ],
  Computing: [
    'A thermally efficient workstation chassis that sustains full clock speeds under sustained load.',
    'Built for creators: instant wake, multi-display output, and a machined aluminium unibody.',
  ],
  'Mobile Accessories': [
    'Magnetic alignment and 65W power delivery in a pocket-sized footprint.',
    'Drop-tested to four times military specification with a braided, reinforced jacket.',
  ],
  'Home & Kitchen': [
    'Precision temperature control with an induction-ready base and dishwasher-safe parts.',
    'Designed for daily use: quiet motor, easy-clean surfaces, and a five-year warranty.',
  ],
  Outdoor: [
    'Ultralight, weather-sealed construction for multi-day trips without the bulk.',
    'Field-tested hardware with reinforced hardware and a packable profile.',
  ],
  Wearables: [
    'Continuous biometric tracking with a seven-day battery and built-in GPS.',
    'Recovery metrics that translate directly into your next training block.',
  ],
};

const FIRST_NAMES = [
  'Amara', 'Noah', 'Priya', 'Mateo', 'Ines', 'Kenji', 'Sofia', 'Liam',
  'Zara', 'Omar', 'Elena', 'Hugo', 'Nadia', 'Felix', 'Aisha', 'Milo',
  'Clara', 'Rafael', 'Yuki', 'Tomas', 'Leila', 'Anders', 'Mira', 'Dario',
] as const;

const LAST_NAMES = [
  'Okafor', 'Lindqvist', 'Raman', 'Alvarez', 'Dubois', 'Tanaka', 'Moreau', 'Bianchi',
  'Haddad', 'Novak', 'Petrov', 'Silva', 'Fischer', 'Costa', 'Nakamura', 'Weber',
  'Ibrahim', 'Larsen', 'Rossi', 'Vargas', 'Kowalski', 'Nguyen', 'Reyes', 'Jansen',
] as const;

const EMAIL_DOMAINS = ['example.com', 'mailbox.co', 'inbox.dev', 'postbox.org'] as const;

/* -------------------------------------------------------------------------- */
/* Stock profile assignment                                                   */
/* -------------------------------------------------------------------------- */

type StockProfile = 'healthy' | 'low' | 'empty' | 'discontinued';

/**
 * Guarantees the KPI cards have something to report: the catalogue always
 * contains healthy, low-stock, out-of-stock and discontinued examples.
 */
const stockProfileForIndex = (index: number): StockProfile => {
  if (index === 21) return 'discontinued';
  if (index % 7 === 0) return 'empty';
  if (index % 7 === 1) return 'low';
  return 'healthy';
};

/* -------------------------------------------------------------------------- */
/* Stock ledger                                                               */
/* -------------------------------------------------------------------------- */

interface LedgerEvent {
  changeType: InventoryChangeType;
  delta: number;
  reason: string;
  atMs: number;
}

/** Strictly increasing timestamps inside `[windowStartMs, windowEndMs]`. */
const buildMonotonicTimestamps = (
  count: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: SeededRandom,
): number[] => {
  const span = Math.max(1, windowEndMs - windowStartMs);
  const ratios = Array.from({ length: count }, () => rng.next()).sort((a, b) => a - b);

  return ratios.reduce<number[]>((timestamps, ratio, index) => {
    const candidate = Math.round(windowStartMs + ratio * span * 0.995);
    const previous = timestamps[index - 1];
    timestamps.push(previous !== undefined && candidate <= previous ? previous + 1000 : candidate);
    return timestamps;
  }, []);
};

/**
 * Produces a sequence of movements whose running balance starts at zero, never
 * goes negative, and lands exactly on `targetQuantity`. That guarantee is what
 * keeps the inventory audit view reconcilable with `Product.totalStock`.
 */
const buildStockLedger = (
  targetQuantity: number,
  rng: SeededRandom,
  windowStartMs: number,
  windowEndMs: number,
  scopeLabel: string,
): LedgerEvent[] => {
  const target = Math.max(0, Math.trunc(targetQuantity));

  if (target === 0) {
    return [
      {
        changeType: 'adjustment',
        delta: 0,
        reason: `Cycle count confirmed no stock on hand for ${scopeLabel}`,
        atMs: windowEndMs,
      },
    ];
  }

  const draft: Omit<LedgerEvent, 'atMs'>[] = [];
  const damageAmount = rng.chance(0.3) ? rng.intBetween(1, Math.max(1, Math.floor(target * 0.15))) : 0;
  const totalInbound = target + damageAmount;
  const parts = rng.intBetween(1, Math.min(3, totalInbound));

  const chunkSize = Math.floor(totalInbound / parts);
  let remainder = totalInbound - chunkSize * parts;

  for (let index = 0; index < parts; index += 1) {
    const amount = remainder > 0 ? chunkSize + 1 : chunkSize;
    remainder = remainder > 0 ? remainder - 1 : 0;
    draft.push({
      changeType: 'restock',
      delta: amount,
      reason: `Purchase order received for ${scopeLabel}`,
    });
  }

  if (damageAmount > 0) {
    draft.push({
      changeType: 'damage',
      delta: -damageAmount,
      reason: `Warehouse damage write-off for ${scopeLabel}`,
    });
  }

  const timestamps = buildMonotonicTimestamps(draft.length, windowStartMs, windowEndMs, rng);
  return draft.map((event, index) => ({ ...event, atMs: timestamps[index] }));
};

const ledgerToLogs = (
  events: readonly LedgerEvent[],
  productId: UUID,
  variantId: UUID | undefined,
  scope: InventoryScope,
  rng: SeededRandom,
): InventoryLog[] => {
  let balance = 0;

  return events.map((event) => {
    const previousQuantity = balance;
    balance += event.delta;
    return {
      id: createUuidV4(rng),
      productId,
      variantId,
      scope,
      changeType: event.changeType,
      quantityDelta: event.delta,
      previousQuantity,
      newQuantity: balance,
      reason: event.reason,
      performedBy: SYSTEM_OPERATOR_NAME,
      timestamp: toIsoUtcString(new Date(event.atMs)),
    };
  });
};

/* -------------------------------------------------------------------------- */
/* Product generation                                                         */
/* -------------------------------------------------------------------------- */

const shuffledSubset = <T,>(
  items: readonly T[],
  size: number,
  rng: SeededRandom,
): T[] => {
  const pool = [...items];
  const taken: T[] = [];

  const limit = Math.max(1, Math.min(size, pool.length));
  for (let index = 0; index < limit; index += 1) {
    const [value] = pool.splice(rng.intBetween(0, pool.length - 1), 1);
    if (value !== undefined) taken.push(value);
  }
  return taken;
};

const buildVariantCombinations = (
  axes: readonly VariantAxis[],
  rng: SeededRandom,
): { attributes: Record<string, string> }[] => {
  const [primaryAxis, secondaryAxis] = axes;
  if (!primaryAxis) return [{ attributes: {} }];

  const primaryValues = shuffledSubset(primaryAxis.values, rng.intBetween(2, 3), rng);
  const primaryCombinations = primaryValues.map((value) => ({
    [primaryAxis.label]: value,
    [primaryAxis.code]: value,
  }));

  if (!secondaryAxis || !rng.chance(0.6)) {
    return primaryCombinations.map((attributes) => ({ attributes }));
  }

  const secondaryValues = shuffledSubset(secondaryAxis.values, rng.intBetween(2, 3), rng);
  const pairs = primaryCombinations.flatMap((primary) =>
    secondaryValues.map((value) => ({
      ...primary,
      [secondaryAxis.label]: value,
      [secondaryAxis.code]: value,
    })),
  );

  return pairs.slice(0, 4).map((attributes) => ({ attributes }));
};

const variantDisplayName = (attributes: Record<string, string>, axisCodes: readonly string[]): string => {
  const parts = axisCodes
    .map((code) => attributes[code])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return parts.length > 0 ? parts.join(' / ') : 'Standard';
};

const buildProduct = (
  index: number,
  category: ProductCategory,
  model: string,
  brand: ProductBrand,
  rng: SeededRandom,
  anchor: Dayjs,
): { product: Product; logs: InventoryLog[] } => {
  const id = createUuidV4(rng);
  const sku = `${BRAND_CODES[brand]}-${CATEGORY_CODES[category]}-${String(index + 1).padStart(4, '0')}`;
  const axes = VARIANT_AXES[category];
  const axisCodes = axes.map((axis) => axis.code);
  const profile = stockProfileForIndex(index);

  const createdAt = anchor.subtract(rng.intBetween(520, 800), 'day').toISOString();
  const updatedAt = anchor.subtract(rng.intBetween(0, 45), 'day').toISOString();
  const windowStartMs = toUtcDayjs(createdAt).valueOf();
  const windowEndMs = toUtcDayjs(updatedAt).valueOf();

  const basePrice = roundToCents(rng.floatBetween(24, 1480, 2));
  const marginRatio = rng.floatBetween(0.28, 0.52, 3);
  const baseCost = roundToCents(basePrice * (1 - marginRatio));

  const combinations = buildVariantCombinations(axes, rng);
  const logs: InventoryLog[] = [];

  const variants: ProductVariant[] = combinations.map((combination, variantIndex) => {
    const variantId = createUuidV4(rng);
    const priceSpread = 1 + (variantIndex - (combinations.length - 1) / 2) * 0.04;
    const price = roundToCents(basePrice * priceSpread);
    const costPrice = roundToCents(price * (1 - marginRatio));
    const safetyStockThreshold = rng.intBetween(4, 18);
    const isArchived = combinations.length > 2 && variantIndex === combinations.length - 1 && rng.chance(0.18);

    const stockQuantity = isArchived
      ? 0
      : profile === 'empty'
        ? 0
        : profile === 'low'
          ? rng.intBetween(0, safetyStockThreshold)
          : rng.intBetween(safetyStockThreshold + 6, 92);

    const variantCreatedAt = anchor
      .subtract(rng.intBetween(300, 520), 'day')
      .toISOString();

    logs.push(
      ...ledgerToLogs(
        buildStockLedger(
          stockQuantity,
          rng,
          Math.max(windowStartMs, toUtcDayjs(variantCreatedAt).valueOf()),
          windowEndMs,
          `${sku} ${variantDisplayName(combination.attributes, axisCodes)}`,
        ),
        id,
        variantId,
        'variant',
        rng,
      ),
    );

    return {
      id: variantId,
      sku: `${sku}-${axisCodes.map((code) => `${code}${variantIndex + 1}`).join('')}`,
      name: variantDisplayName(combination.attributes, axisCodes),
      price,
      costPrice,
      stockQuantity,
      safetyStockThreshold,
      attributes: combination.attributes,
      isArchived,
      createdAt: variantCreatedAt,
      updatedAt,
    };
  });

  const totalStock = variants
    .filter((variant) => !variant.isArchived)
    .reduce((sum, variant) => sum + variant.stockQuantity, 0);

  const safetyStockThreshold = rng.intBetween(6, 24);
  const currentStatus =
    profile === 'discontinued' ? ('discontinued' as const) : ('in_stock' as const);

  const product: Product = {
    id,
    sku,
    name: model,
    category,
    brand,
    description: rng.pick(DESCRIPTION_OPENERS[category]),
    basePrice,
    baseCost,
    totalStock,
    safetyStockThreshold,
    status: currentStatus,
    variants,
    tags: shuffledSubset(TAG_POOL[category], rng.intBetween(2, 3), rng),
    isArchived: index >= SEED_PRODUCT_COUNT - 2,
    createdAt,
    updatedAt,
  };

  if (product.isArchived) {
    product.deletedAt = anchor.subtract(rng.intBetween(5, 40), 'day').toISOString();
  }

  product.status = resolveStockStatus(product);

  logs.push(
    ...ledgerToLogs(
      buildStockLedger(totalStock, rng, windowStartMs, windowEndMs, `${sku} (product level)`),
      id,
      undefined,
      'product',
      rng,
    ),
  );

  return { product, logs };
};

/* -------------------------------------------------------------------------- */
/* Customer + order generation                                                */
/* -------------------------------------------------------------------------- */

interface CustomerSeed {
  id: UUID;
  name: string;
  email: string;
  country: ShippingCountry;
}

const buildCustomers = (rng: SeededRandom): CustomerSeed[] => {
  const customers: CustomerSeed[] = [];
  const usedEmails = new Set<string>();

  for (let index = 0; index < SEED_CUSTOMER_COUNT; index += 1) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const baseEmail = `${firstName}.${lastName}`.toLowerCase();

    let email = `${baseEmail}@${rng.pick(EMAIL_DOMAINS)}`;
    let suffix = 2;
    while (usedEmails.has(email)) {
      email = `${baseEmail}${suffix}@${rng.pick(EMAIL_DOMAINS)}`;
      suffix += 1;
    }
    usedEmails.add(email);

    customers.push({
      id: createUuidV4(rng),
      name: `${firstName} ${lastName}`,
      email,
      country: rng.pick(SHIPPING_COUNTRIES),
    });
  }

  return customers;
};

/**
 * Minimum order age, in days, before a lifecycle state is plausible. Used both
 * by the weighted sampler and by the coverage pass that guarantees each state
 * appears at least once without fabricating an impossible history.
 */
const MINIMUM_AGE_DAYS_FOR_STATUS: Record<OrderStatus, number> = {
  pending: 0,
  processing: 0,
  shipped: 2,
  delivered: 5,
  cancelled: 1,
  refunded: 5,
};

/** Baseline desirability per state before the age-based funnel is applied. */
const STATUS_BASE_WEIGHT: Record<OrderStatus, number> = {
  pending: 60,
  processing: 40,
  shipped: 55,
  delivered: 95,
  cancelled: 9,
  refunded: 7,
};

/**
 * Samples a lifecycle state whose weight decays with how long the order has had
 * to progress. A three-day-old order cannot be `delivered`; a year-old order is
 * overwhelmingly `delivered` with a long tail of cancellations and refunds.
 */
const pickOrderStatus = (ageInDays: number, rng: SeededRandom): OrderStatus => {
  const elapsed = Math.min(1, ageInDays / SEED_TRAILING_DAYS);
  const decay = (baseWeight: number, peak: number, sharpness: number): number => {
    const value = baseWeight * (1 - Math.abs(elapsed - peak) * sharpness);
    return value > 0 ? value : 0;
  };

  const weights: Record<OrderStatus, number> = {
    pending: decay(STATUS_BASE_WEIGHT.pending, 0, 12),
    processing: decay(STATUS_BASE_WEIGHT.processing, 0.02, 12),
    shipped: decay(STATUS_BASE_WEIGHT.shipped, 0.06, 8),
    delivered: STATUS_BASE_WEIGHT.delivered,
    cancelled: STATUS_BASE_WEIGHT.cancelled,
    refunded: STATUS_BASE_WEIGHT.refunded,
  };

  const eligible = ORDER_STATUSES.filter(
    (status) => ageInDays >= MINIMUM_AGE_DAYS_FOR_STATUS[status] && weights[status] > 0,
  ).map((status) => [status, weights[status]] as const);

  return rng.weighted<OrderStatus>(eligible);
};

/**
 * Guarantees every lifecycle state is represented — an empty status bucket
 * would make the transition graph and the status filter untestable — while
 * keeping each assignment plausible by only promoting orders that are old
 * enough to have reached that state.
 */
const ensureStatusCoverage = (drafts: OrderDraft[]): void => {
  for (const status of ORDER_STATUSES) {
    if (drafts.some((draft) => draft.status === status)) continue;

    const eligible = drafts.filter((draft) => draft.ageInDays >= MINIMUM_AGE_DAYS_FOR_STATUS[status]);
    const pool = eligible.length > 0 ? eligible : drafts;
    const candidate = pool.reduce((youngest, draft) =>
      draft.ageInDays < youngest.ageInDays ? draft : youngest,
    );
    candidate.status = status;
  }
};

interface OrderDraft {
  /** Days between the order and the seed anchor; drives lifecycle realism. */
  ageInDays: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  customerIndex: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  netProfit: number;
}

const buildOrderItems = (
  catalogue: readonly Product[],
  rng: SeededRandom,
): OrderItem[] => {
  const lineCount = rng.intBetween(1, 4);
  const usedKeys = new Set<string>();
  const items: OrderItem[] = [];

  for (let line = 0; line < lineCount; line += 1) {
    const sellable = catalogue.filter(
      (product) => !product.isArchived && activeVariants(product).length > 0,
    );
    const product = rng.pick(sellable.length > 0 ? sellable : catalogue);
    const variants = activeVariants(product);
    if (variants.length === 0) continue;

    const variant = rng.pick(variants);
    const key = variant.id;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    const quantity = rng.intBetween(1, 4);

    items.push({
      id: createUuidV4(rng),
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku,
      productName: `${product.name} — ${variant.name}`,
      quantity,
      unitPrice: variant.price,
      unitCost: variant.costPrice,
      subtotal: roundToCents(variant.price * quantity),
    });
  }

  return items;
};

const buildOrderDrafts = (
  catalogue: readonly Product[],
  customerCount: number,
  rng: SeededRandom,
  anchor: Dayjs,
): OrderDraft[] => {
  const drafts: OrderDraft[] = [];

  for (let index = 0; index < SEED_ORDER_COUNT; index += 1) {
    // `Math.pow(..., 1.4)` skews volume toward the recent past so the seeded
    // period-over-period growth figures are positive and meaningful.
    const ageInDays = Math.floor(SEED_TRAILING_DAYS * Math.pow(rng.next(), 1.4));

    const dayStart = anchor.subtract(ageInDays, 'day').startOf('day');
    const requestedCreatedAt = dayStart
      .add(rng.intBetween(7, 21), 'hour')
      .add(rng.intBetween(0, 59), 'minute')
      .add(rng.intBetween(0, 59), 'second');

    // Orders landing on the anchor day must not be stamped in the future: pull
    // them back inside the elapsed portion of today.
    const createdAt = (
      requestedCreatedAt.valueOf() <= anchor.valueOf()
        ? requestedCreatedAt
        : anchor.subtract(rng.intBetween(1, 240), 'minute')
    ).toISOString();

    const createdMs = toUtcDayjs(createdAt).valueOf();
    const requestedUpdatedMs = toUtcDayjs(createdAt).add(rng.intBetween(2, 96), 'hour').valueOf();
    const earliestUpdatedMs = Math.min(createdMs + 60_000, anchor.valueOf());
    const updatedMs = Math.min(Math.max(requestedUpdatedMs, earliestUpdatedMs), anchor.valueOf());
    const updatedAt = toIsoUtcString(new Date(updatedMs));

    const items = buildOrderItems(catalogue, rng);
    if (items.length === 0) continue;

    // Cycle the payment methods over the first orders so no filter bucket is
    // empty, then fall back to a realistic weighted distribution.
    const forcedMethod =
      index < PAYMENT_METHODS.length ? PAYMENT_METHODS[index] : undefined;

    const subtotal = roundToCents(items.reduce((sum, item) => sum + item.subtotal, 0));
    const discountAmount = rng.chance(0.25)
      ? roundToCents(subtotal * rng.floatBetween(0.05, 0.15, 3))
      : 0;
    const taxableBase = roundToCents(subtotal - discountAmount);
    const shippingFee = taxableBase >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_FEE;
    const taxAmount = roundToCents(taxableBase * TAX_RATE);
    const totalAmount = roundToCents(taxableBase + taxAmount + shippingFee);
    const orderCost = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

    drafts.push({
      ageInDays,
      createdAt,
      updatedAt,
      customerIndex: rng.intBetween(0, customerCount - 1),
      status: pickOrderStatus(ageInDays, rng),
      paymentMethod:
        forcedMethod ??
        rng.weighted<PaymentMethod>([
          ['credit_card', 55],
          ['digital_wallet', 25],
          ['bank_transfer', 12],
          ['cash_on_delivery', 8],
        ]),
      items,
      subtotal,
      taxAmount,
      shippingFee,
      discountAmount,
      totalAmount,
      netProfit: roundToCents(totalAmount - orderCost - shippingFee - taxAmount),
    });
  }

  ensureStatusCoverage(drafts);

  return drafts;
};

/* -------------------------------------------------------------------------- */
/* Dataset assembly                                                           */
/* -------------------------------------------------------------------------- */

export interface SeedDataset {
  products: Product[];
  orders: Order[];
  inventoryLogs: InventoryLog[];
}

export interface SeedSummary {
  products: number;
  orders: number;
  inventoryLogs: number;
  customers: number;
}

export const buildSeedDataset = (now: Date = new Date()): SeedDataset => {
  const rng = createSeededRandom(SEED_RANDOM_SEED);
  const anchor = toUtcDayjs(now);

  const products: Product[] = [];
  const inventoryLogs: InventoryLog[] = [];

  let modelIndex = 0;
  for (const category of PRODUCT_CATEGORIES) {
    for (const model of PRODUCT_MODELS[category]) {
      const brand = PRODUCT_BRANDS[modelIndex % PRODUCT_BRANDS.length];
      const { product, logs } = buildProduct(modelIndex, category, model, brand, rng, anchor);
      products.push(product);
      inventoryLogs.push(...logs);
      modelIndex += 1;
    }
  }

  const customers = buildCustomers(rng);
  const drafts = buildOrderDrafts(products, customers.length, rng, anchor).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const orderTotals = new Array<number>(customers.length).fill(0);
  for (const draft of drafts) {
    orderTotals[draft.customerIndex] += 1;
  }

  const orders: Order[] = drafts.map((draft, index) => {
    const customer = customers[draft.customerIndex];
    const summary: CustomerSummary = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      country: customer.country,
      totalOrdersCount: orderTotals[draft.customerIndex],
    };

    const createdYear = draft.createdAt.slice(0, 4);

    return {
      id: createUuidV4(rng),
      orderNumber: `ORD-${createdYear}-${String(index + 1).padStart(5, '0')}`,
      customer: summary,
      items: draft.items,
      subtotal: draft.subtotal,
      taxAmount: draft.taxAmount,
      shippingFee: draft.shippingFee,
      discountAmount: draft.discountAmount,
      totalAmount: draft.totalAmount,
      netProfit: draft.netProfit,
      status: draft.status,
      paymentMethod: draft.paymentMethod,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  });

  inventoryLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { products, orders, inventoryLogs };
};

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export const isDatabaseSeeded = async (): Promise<boolean> => {
  const [productCount, orderCount] = await Promise.all([db.products.count(), db.orders.count()]);
  return productCount > 0 && orderCount > 0;
};

/**
 * Writes the dataset in one read-write transaction. Callers must have checked
 * `isDatabaseSeeded()` first — this intentionally overwrites, so a re-seed
 * belongs to `resetAndSeedDatabase`.
 */
export const seedDatabase = async (now: Date = new Date()): Promise<SeedSummary> => {
  const dataset = buildSeedDataset(now);

  await db.transaction('rw', db.products, db.orders, db.inventoryLogs, async () => {
    await db.products.bulkAdd(dataset.products);
    await db.orders.bulkAdd(dataset.orders);
    await db.inventoryLogs.bulkAdd(dataset.inventoryLogs);
  });

  return {
    products: dataset.products.length,
    orders: dataset.orders.length,
    inventoryLogs: dataset.inventoryLogs.length,
    customers: SEED_CUSTOMER_COUNT,
  };
};

/** Idempotent boot path: seeds only when the store is still empty. */
export const seedDatabaseIfEmpty = async (now: Date = new Date()): Promise<SeedSummary | null> => {
  if (await isDatabaseSeeded()) return null;
  return seedDatabase(now);
};

export const resetAndSeedDatabase = async (now: Date = new Date()): Promise<SeedSummary> => {
  await db.transaction('rw', db.products, db.orders, db.inventoryLogs, async () => {
    await Promise.all([db.products.clear(), db.orders.clear(), db.inventoryLogs.clear()]);
  });
  return seedDatabase(now);
};

/** Timestamp stamped onto the app shell so operators can see when data landed. */
export const seedMarker = (): ISODateString => nowIsoUtc();
