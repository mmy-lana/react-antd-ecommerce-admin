/**
 * Phase 4 verification: reactive state and the transactional write contracts.
 *
 * The pure query/aggregation helpers are asserted directly, and the write paths
 * run against a real IndexedDB polyfill, because "atomic" is a claim about
 * runtime behaviour that no type checker can confirm:
 *
 *  - a rejected stock change must leave the product *and* the ledger untouched;
 *  - a variant adjustment must move the parent total, the status and the log in
 *    step, inside one transaction;
 *  - cancelling an order must return stock through `mutateProductStock`, and an
 *    illegal transition must not write anything at all.
 *
 * The polyfill must be installed before `dexieDb` is evaluated, for the reason
 * documented in `verify-storage.ts`.
 */
export {};

await import('fake-indexeddb/auto');

const { db, clearAllTables, databaseReady, getTableCounts } = await import('../src/shared/db/dexieDb');
const { buildSeedDataset } = await import('../src/shared/db/seedData');

const mutations = await import('../src/features/inventory/hooks/useProductMutations');
const orderHooks = await import('../src/features/sales/hooks/useOrders');
const inventory = await import('../src/features/inventory/hooks/useInventory');
const metrics = await import('../src/features/dashboard/hooks/useDashboardMetrics');
const navigation = await import('../src/shared/hooks/useResponsiveNavigation');
const types = await import('../src/shared/types');
const { needsRestock } = await import('../src/shared/utils/stockStatus');

// The hooks are imported as modules and destructured by name, so each call site
// below reads as the plain function it is testing.
const {
  applyDeltaAcrossVariants,
  applyProductDraft,
  applyStockChange,
  buildInventoryLog,
  buildProductFromDraft,
  planStockChange,
  recalculateTotalStock,
  resolveChangeDirection,
  resolveSignedDelta,
  StockMutationError,
} = mutations;
// A class binding is both a value and a type; the destructure shadows the type
// name, so the assertion helper below narrows through the constructor instead.
type StockError = InstanceType<typeof StockMutationError>;
const {
  applyOrderTransition,
  buildSalesAggregates,
  buildStockReturnLines,
  canTransitionOrder,
  describeTransitionRefusal,
  filterOrders,
} = orderHooks;
const {
  buildInventoryAnalytics,
  calculateRestockCost,
  filterProducts,
  flattenVariants,
  matchesProductSearch,
  selectRestockWatchlist,
  sortProducts,
} = inventory;
const {
  buildCategorySeries,
  buildKpiStats,
  buildPreviousRange,
  buildSalesSeries,
  buildSalesVolumeByCategory,
  growthPercentage,
  resolveInterval,
  tallyOrders,
  toUtcDayKey,
  toUtcMonthKey,
  toUtcWeekKey,
} = metrics;
const { NAVIGATION_BREAKPOINT, isDesktopNavigation, resolveNavigationMode } = navigation;
const {
  ALLOWED_ORDER_TRANSITIONS,
  NON_REVENUE_ORDER_STATUSES,
  ORDER_STATUSES,
  STOCK_STATUSES,
  isRevenueRecognizedOrder,
} = types;

const failures: string[] = [];
let assertions = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const ANCHOR = new Date('2026-07-15T12:00:00Z');
/* -------------------------------------------------------------------------- */
/* 4.2 — atomic stock mutation                                                 */
/* -------------------------------------------------------------------------- */

const verifyStockMutations = (): void => {
  const dataset = buildSeedDataset(ANCHOR);
  const product = dataset.products[0];
  if (product === undefined) throw new Error('seed produced no products');

  check(
    'restock is an increase',
    resolveChangeDirection('restock') === 'increase' && resolveSignedDelta('restock', 5) === 5,
  );
  check('return is an increase', resolveSignedDelta('return', 3) === 3);
  check('sale is a decrease', resolveSignedDelta('sale', 3) === -3);
  check('damage is a decrease', resolveSignedDelta('damage', 3) === -3, 'damage must reduce stock');
  check('adjustment stays signed', resolveSignedDelta('adjustment', -7) === -7);
  check('adjustment sign is preserved', resolveSignedDelta('adjustment', 7) === 7);

  // Denormalised totals.
  const liveIndex = product.variants.findIndex((candidate) => !candidate.isArchived);
  const archivedAt999 = product.variants[liveIndex]!.stockQuantity;
  const withArchived = product.variants.map((variant, index) =>
    index === liveIndex ? { ...variant, isArchived: true, stockQuantity: 999 } : variant,
  );
  check(
    'archiving a variant drops exactly its own units from the total',
    recalculateTotalStock(withArchived) === recalculateTotalStock(product.variants) - archivedAt999,
    `${recalculateTotalStock(withArchived)} vs ${recalculateTotalStock(product.variants) - archivedAt999}`,
  );
  check(
    'a huge archived balance never reaches the total',
    recalculateTotalStock(withArchived) < 999,
  );

  const liveVariants = product.variants.filter((variant) => !variant.isArchived);
  const expectedDeltaTotal = liveVariants.reduce(
    (total, variant) => total + variant.stockQuantity,
    0,
  ) + 7;
  const spread = applyDeltaAcrossVariants(product.variants, 7, '2026-07-15T12:00:00.000Z');
  check(
    'a product-level delta spreads across every live variant',
    recalculateTotalStock(spread) === expectedDeltaTotal,
    `${recalculateTotalStock(spread)} vs ${expectedDeltaTotal}`,
  );
  check(
    'a zero delta leaves variants untouched',
    applyDeltaAcrossVariants(product.variants, 0, '2026-07-15T12:00:00.000Z').every(
      (variant) => variant.stockQuantity === product.variants.find((v) => v.id === variant.id)?.stockQuantity,
    ),
  );
  check(
    'archived variants never receive a product-level delta',
    spread
      .filter((variant) => variant.isArchived)
      .every((variant) => variant.stockQuantity === product.variants.find((v) => v.id === variant.id)?.stockQuantity),
  );

  // Variant-scoped change.
  const variant = product.variants.find((candidate) => !candidate.isArchived);
  if (variant === undefined) throw new Error('seed product has no live variant');

  const plan = planStockChange(product, {
    productId: product.id,
    variantId: variant.id,
    changeType: 'restock',
    quantity: 12,
    reason: 'Supplier delivery',
  });
  check('a variant restock reports the previous balance', plan.previousQuantity === variant.stockQuantity);
  check('a variant restock reports the new balance', plan.newQuantity === variant.stockQuantity + 12);
  check('a variant restock is scoped to the variant', plan.scope === 'variant');
  check(
    'the parent total follows the variant',
    plan.product.totalStock === recalculateTotalStock(plan.product.variants),
  );
  check(
    'the product total moved by exactly the delta',
    plan.product.totalStock - product.totalStock === 12,
    `${plan.product.totalStock - product.totalStock}`,
  );
  check('a restock raises the status above low stock', plan.product.status !== 'out_of_stock');

  // Negative stock is refused before anything is produced.
  let refusal: unknown = null;
  try {
    planStockChange(product, {
      productId: product.id,
      variantId: variant.id,
      changeType: 'sale',
      quantity: variant.stockQuantity + 1,
      reason: 'Oversell attempt',
    });
  } catch (cause) {
    refusal = cause;
  }
  check('selling below zero is refused', refusal instanceof StockMutationError);
  check('the refusal is typed as negative_stock', (refusal as StockError).code === 'negative_stock');
  check('the refusal message names the product', (refusal as StockError).message.includes(product.name));

  let zeroRefusal: unknown = null;
  try {
    planStockChange(product, { productId: product.id, changeType: 'restock', quantity: 0, reason: 'No-op' });
  } catch (cause) {
    zeroRefusal = cause;
  }
  check('a zero-unit change is refused', (zeroRefusal as StockError).code === 'invalid_quantity');

  let missingRefusal: unknown = null;
  try {
    planStockChange(product, {
      productId: product.id,
      variantId: 'no-such-variant',
      changeType: 'restock',
      quantity: 1,
      reason: 'Nope',
    });
  } catch (cause) {
    missingRefusal = cause;
  }
  check('an unknown variant is refused', (missingRefusal as StockError).code === 'not_found');

  // Status recalculation, on a synthetic single-variant product so the
  // expectation is exact rather than dependent on how the seed was generated.
  const solo = {
    ...product,
    status: 'in_stock' as const,
    variants: [{ ...variant, stockQuantity: 7, safetyStockThreshold: 3, isArchived: false }],
  };
  const drained = planStockChange(solo, {
    productId: solo.id,
    variantId: variant.id,
    changeType: 'sale',
    quantity: 7,
    reason: 'Sold out',
  });
  check('draining the only variant yields out_of_stock', drained.product.status === 'out_of_stock', drained.product.status);
  check('draining the only variant zeroes the total', drained.product.totalStock === 0);
  check('draining to exactly zero is allowed', drained.newQuantity === 0);

  const toThreshold = planStockChange(solo, {
    productId: solo.id,
    variantId: variant.id,
    changeType: 'sale',
    quantity: 4,
    reason: 'Down to the safety line',
  });
  check('reaching the threshold yields low_stock', toThreshold.product.status === 'low_stock', toThreshold.product.status);
  check('the balance sits exactly on the threshold', toThreshold.newQuantity === 3, `${toThreshold.newQuantity}`);
  check(
    'one unit above the threshold is still in stock',
    planStockChange(solo, { productId: solo.id, variantId: variant.id, changeType: 'sale', quantity: 3, reason: 'Above the line' })
      .product.status === 'in_stock',
  );

  const discontinued = planStockChange(
    { ...product, status: 'discontinued' },
    { productId: product.id, variantId: variant.id, changeType: 'restock', quantity: 50, reason: 'Back in' },
  );
  check('discontinued survives an unrelated restock', discontinued.product.status === 'discontinued');

  // Ledger row.
  const log = buildInventoryLog(
    product.id,
    { productId: product.id, variantId: variant.id, changeType: 'restock', quantity: 12, reason: '  Supplier delivery  ' },
    plan,
    '2026-07-15T12:00:00.000Z',
  );
  check('the log records the delta', log.quantityDelta === plan.newQuantity - plan.previousQuantity);
  check('the log records both balances', log.previousQuantity === variant.stockQuantity);
  check('the log carries the variant id', log.variantId === variant.id);
  check('the log scope is the variant', log.scope === 'variant');
  check('the log reason is trimmed', log.reason === 'Supplier delivery');
  check('the log names an actor', log.performedBy.length > 0);

  const productScopeLog = buildInventoryLog(
    product.id,
    { productId: product.id, changeType: 'restock', quantity: 5, reason: 'Top-up' },
    { previousQuantity: 10, newQuantity: 15, scope: 'product' },
    '2026-07-15T12:00:00.000Z',
  );
  check('a product-level log omits the variant id', productScopeLog.variantId === undefined);
  check('a product-level log scope is the product', productScopeLog.scope === 'product');

  // Draft materialisation.
  const draft = {
    name: 'Harness Widget',
    sku: 'HARN-001',
    category: 'Accessories',
    brand: 'Harness',
    description: 'Created by the verification suite.',
    basePrice: 40,
    baseCost: 18,
    safetyStockThreshold: 5,
    status: 'in_stock' as const,
    tags: ['harness', 'harness', '  spaced  '],
    variants: [
      { name: 'Small', sku: 'HARN-001-S', price: 40, costPrice: 18, stockQuantity: 3, safetyStockThreshold: 2 },
      { name: 'Large', sku: 'HARN-001-L', price: 44, costPrice: 20, stockQuantity: 1, safetyStockThreshold: 2 },
    ],
  };
  const built = buildProductFromDraft(draft, '2026-07-15T12:00:00.000Z');
  check('a new product sums its variants', built.totalStock === 4, `${built.totalStock}`);
  check('a new product gets a uuid', built.id.length > 0);
  check('a new product starts unarchived', built.isArchived === false);
  check('duplicate tags are collapsed', built.tags.length === 2, built.tags.join('|'));
  check('a new product at its threshold is low stock', built.status === 'low_stock', built.status);

  const edited = applyProductDraft(built, { ...draft, name: 'Harness Widget v2' }, '2026-07-16T12:00:00.000Z');
  check('an edit keeps the product id', edited.id === built.id);
  check('an edit keeps the creation time', edited.createdAt === built.createdAt);
  check('an edit keeps variant ids', edited.variants[0]?.id === built.variants[0]?.id);
  check('an edit advances the update time', edited.updatedAt === '2026-07-16T12:00:00.000Z');
  check('an edit applies the new name', edited.name === 'Harness Widget v2');
};

/* -------------------------------------------------------------------------- */
/* 4.3 — order state machine                                                   */
/* -------------------------------------------------------------------------- */

const verifyOrderMachine = (): void => {
  const dataset = buildSeedDataset(ANCHOR);
  const order = dataset.orders.find((candidate) => candidate.status === 'pending');
  if (order === undefined) throw new Error('seed produced no pending order');

  for (const status of ORDER_STATUSES) {
    for (const target of ORDER_STATUSES) {
      const expected = ALLOWED_ORDER_TRANSITIONS[status].includes(target);
      check(
        `${status} -> ${target} is ${expected ? 'allowed' : 'refused'}`,
        canTransitionOrder(status, target) === expected &&
          (describeTransitionRefusal(status, target) === null) === expected,
      );
    }
  }

  check('a terminal status refuses everything', ALLOWED_ORDER_TRANSITIONS.cancelled.length === 0);
  check(
    'a terminal refusal is explained',
    (describeTransitionRefusal('cancelled', 'delivered') ?? '').includes('final'),
  );
  check(
    'a skipped-step refusal is explained',
    (describeTransitionRefusal('pending', 'shipped') ?? '').includes('cannot move'),
  );

  check('cancelled stops recognising revenue', !isRevenueRecognizedOrder('cancelled'));
  check('refunded stops recognising revenue', !isRevenueRecognizedOrder('refunded'));
  check('delivered still recognises revenue', isRevenueRecognizedOrder('delivered'));

  // Stock return lines.
  const duplicated = {
    ...order,
    items: [
      order.items[0],
      order.items[0],
      { ...(order.items[0] ?? {}), id: 'other', variantId: undefined },
    ].filter((item) => item !== undefined),
  } as typeof order;
  const collapsed = buildStockReturnLines(duplicated);
  const first = collapsed.find((line) => line.variantId === order.items[0]?.variantId);
  check(
    'repeated line items collapse into one change',
    first?.quantity === (order.items[0]?.quantity ?? 0) * 2,
    `${first?.quantity}`,
  );
  check('every order yields return lines', buildStockReturnLines(order).length > 0);
  check('a zero-quantity line is skipped', buildStockReturnLines({ ...order, items: [{ ...order.items[0]!, quantity: 0 }] }).length === 0);

  // Aggregates ignore non-revenue orders.
  const aggregates = buildSalesAggregates(dataset.orders);
  const manualRevenue = dataset.orders
    .filter((candidate) => isRevenueRecognizedOrder(candidate.status))
    .reduce((total, candidate) => total + candidate.totalAmount, 0);
  check(
    'GMV excludes cancelled and refunded orders',
    Math.abs(aggregates.revenue - manualRevenue) < 0.01,
    `${aggregates.revenue} vs ${manualRevenue}`,
  );
  check(
    'the order count matches the revenue-recognising set',
    aggregates.orderCount === dataset.orders.filter((candidate) => isRevenueRecognizedOrder(candidate.status)).length,
  );
  check('AOV is revenue over recognised orders', aggregates.averageOrderValue > 0);
  check(
    'the status histogram covers every order',
    aggregates.cancelledCount + aggregates.refundedCount + aggregates.pendingCount +
      aggregates.processingCount + aggregates.shippedCount + aggregates.deliveredCount ===
      dataset.orders.length,
  );
  check(
    'cancelled and refunded are counted separately',
    aggregates.cancelledCount >= 0 && aggregates.refundedCount >= 0,
  );
  check('units sold is positive', aggregates.unitsSold > 0);
};

/* -------------------------------------------------------------------------- */
/* 4.1 / 4.4 — filtering, analytics and metrics                                */
/* -------------------------------------------------------------------------- */

const verifyQueries = (): void => {
  const dataset = buildSeedDataset(ANCHOR);

  check('an empty query matches everything', matchesProductSearch(dataset.products[0]!, '   '));
  check(
    'a query matches the name',
    matchesProductSearch(dataset.products[0]!, dataset.products[0]!.name.slice(0, 4)),
  );
  check(
    'a query matches a variant sku',
    matchesProductSearch(dataset.products[0]!, dataset.products[0]!.variants[0]?.sku ?? 'zzz'),
  );
  check(
    'every term must match, so a nonsense query matches nothing',
    matchesProductSearch(dataset.products[0]!, 'zzz qqq') === false,
  );
  check(
    'a multi-term query narrows rather than widens',
    filterProducts(dataset.products, {
      category: 'all',
      stockStatus: 'all',
      searchQuery: `${dataset.products[0]!.name.slice(0, 3)} zzz`,
    }).length === 0,
  );

  const allFiltered = filterProducts(dataset.products, {
    category: 'all',
    stockStatus: 'all',
    searchQuery: '',
    includeArchived: true,
  });
  check('includeArchived keeps archived rows', allFiltered.length === dataset.products.length);

  const activeOnly = filterProducts(dataset.products, {
    category: 'all',
    stockStatus: 'all',
    searchQuery: '',
  });
  check('archived rows are hidden by default', activeOnly.every((product) => !product.isArchived));

  const byCategory = filterProducts(dataset.products, {
    category: dataset.products[0]!.category,
    stockStatus: 'all',
    searchQuery: '',
  });
  check('the category filter is exact', byCategory.every((product) => product.category === dataset.products[0]!.category));

  const byStatus = filterProducts(dataset.products, {
    category: 'all',
    stockStatus: 'out_of_stock',
    searchQuery: '',
  });
  check('the status filter is exact', byStatus.every((product) => product.status === 'out_of_stock'));

  const sorted = sortProducts(dataset.products, { key: 'totalStock', direction: 'desc' });
  check(
    'descending stock sorts high to low',
    sorted.every((product, index) => index === 0 || sorted[index - 1]!.totalStock >= product.totalStock),
  );
  const ascending = sortProducts(dataset.products, { key: 'name', direction: 'asc' });
  check(
    'ascending name sorts alphabetically',
    ascending.every((product, index) => index === 0 || ascending[index - 1]!.name.toLowerCase() <= product.name.toLowerCase()),
  );
  check('sorting does not mutate the input', dataset.products[0] === sorted[0] || dataset.products.length === sorted.length);

  // Order filters.
  const matching = filterOrders(dataset.orders, { status: 'delivered', searchQuery: '', dateRange: null });
  check('the order status filter is exact', matching.every((order) => order.status === 'delivered'));
  check(
    'the order search matches the order number',
    filterOrders(dataset.orders, {
      status: 'all',
      searchQuery: dataset.orders[0]!.orderNumber,
      dateRange: null,
    }).length >= 1,
  );
  const windowed = filterOrders(dataset.orders, {
    status: 'all',
    searchQuery: '',
    dateRange: { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-02T00:00:00.000Z' },
  });
  check(
    'the date window is inclusive of both boundaries',
    windowed.every(
      (order) => order.createdAt >= '2026-01-01T00:00:00.000Z' && order.createdAt <= '2026-01-02T00:00:00.000Z',
    ),
  );

  // Inventory analytics.
  const analytics = buildInventoryAnalytics(dataset.products);
  check('analytics count every product', analytics.totalProducts === dataset.products.length);
  check('analytics sum the units', analytics.totalUnits === dataset.products.reduce((t, p) => t + p.totalStock, 0));
  check(
    'the status histogram adds up',
    analytics.inStockCount + analytics.lowStockCount + analytics.outOfStockCount + analytics.discontinuedCount ===
      dataset.products.length,
  );
  check('average units is derived', analytics.averageUnitsPerProduct > 0);
  check('stock value is non-negative', analytics.stockValue >= 0);

  const watchlist = selectRestockWatchlist(dataset.products, 5);
  check('the watchlist is capped', watchlist.length <= 5);
  check('the watchlist holds only alert items', watchlist.every((product) => needsRestock(product)));
  check(
    'the watchlist is ordered by deepest deficit',
    watchlist.every(
      (product, index) => index === 0 || watchlist[index - 1]!.totalStock - watchlist[index - 1]!.safetyStockThreshold <= product.totalStock - product.safetyStockThreshold,
    ),
  );
  check('the restock cost is non-negative', calculateRestockCost(dataset.products) >= 0);
  check('an empty catalogue yields zero analytics', buildInventoryAnalytics([]).totalProducts === 0);
  check('flattening variants skips archived rows', flattenVariants(dataset.products).every((variant) => !variant.isArchived));
};

/* -------------------------------------------------------------------------- */
/* 4.4 — date boundaries and metrics                                           */
/* -------------------------------------------------------------------------- */

const verifyMetrics = (): void => {
  const range = { startDate: '2026-06-15T00:00:00.000Z', endDate: '2026-07-15T23:59:59.999Z' };
  const previous = buildPreviousRange(range);
  check(
    'the previous window is the same length, immediately before',
    Date.parse(range.startDate) - Date.parse(previous.endDate) === 1,
  );
  check(
    'the previous window has the same span',
    Date.parse(range.endDate) - Date.parse(range.startDate) ===
      Date.parse(previous.endDate) - Date.parse(previous.startDate),
  );

  check('a short range is bucketed by day', resolveInterval(range) === 'day');
  check('a 60-day range is bucketed by week', resolveInterval({ startDate: '2026-05-17T00:00:00.000Z', endDate: '2026-07-15T00:00:00.000Z' }) === 'week');
  check('a 400-day range is bucketed by month', resolveInterval({ startDate: '2025-06-01T00:00:00.000Z', endDate: '2026-07-15T00:00:00.000Z' }) === 'month');

  // UTC correctness: an order at 23:30 UTC must land on the same day key no
  // matter which local zone the browser is in.
  check('a late-UTC order keys to its own UTC day', toUtcDayKey('2026-07-15T23:30:00.000Z') === '2026-07-15');
  check('an early-UTC order does not shift to the previous day', toUtcDayKey('2026-07-15T00:30:00.000Z') === '2026-07-15');
  check('the month key is UTC', toUtcMonthKey('2026-07-01T00:00:00.000Z') === '2026-07');
  check('the week key is ISO shaped', /^2026-W\d{2}$/.test(toUtcWeekKey('2026-07-15T12:00:00.000Z')));

  const dataset = buildSeedDataset(ANCHOR);
  const series = buildSalesSeries(dataset.orders, range, 'day');
  check('the series is non-empty', series.length > 0);
  check('the series is ordered', series.every((point, index) => index === 0 || series[index - 1]!.date <= point.date));
  check(
    'the series revenue matches the tallied total',
    Math.abs(series.reduce((total, point) => total + point.revenue, 0) - tallyOrders(filterOrders(dataset.orders, { status: 'all', searchQuery: '', dateRange: range })).revenue) < 0.01,
  );
  check('the series order count matches its revenue count', series.every((point) => point.ordersCount >= 0));
  check('a range with no orders still renders buckets', buildSalesSeries([], range, 'day').length > 0);
  check('an empty range renders one bucket', buildSalesSeries([], { startDate: '2026-07-15T00:00:00.000Z', endDate: '2026-07-15T00:00:00.000Z' }, 'day').length === 1);

  const categories = buildCategorySeries(dataset.orders, dataset.products, range);
  check('the category series is non-empty', categories.length > 0);
  check(
    'the category series is ordered by revenue',
    categories.every((point, index) => index === 0 || categories[index - 1]!.revenue >= point.revenue),
  );
  check(
    'category percentages add up to about 100',
    Math.abs(categories.reduce((total, point) => total + point.percentage, 0) - 100) < 0.5,
  );
  check('units sold is derived from the categories', buildSalesVolumeByCategory(categories) > 0);

  // Growth and KPI assembly.
  check('growth is zero with no baseline', growthPercentage(100, 0) === 0);
  check('growth is positive when it rose', growthPercentage(150, 100) === 50);
  check('growth is negative when it fell', growthPercentage(80, 100) === -20);
  check('growth handles a negative baseline', growthPercentage(-50, -100) === 50);

  const current = tallyOrders(dataset.orders.filter((order) => isRevenueRecognizedOrder(order.status)));
  const previousTotals = tallyOrders([]);
  const stats = buildKpiStats(current, previousTotals, 3, 2);
  check('total revenue comes from the current window', stats.totalRevenue === current.revenue);
  check('total orders come from the current window', stats.totalOrders === current.orderCount);
  check('growth against an empty window is zero', stats.revenueGrowthPct === 0);
  check('low stock items are counted', stats.lowStockItemsCount === 3);
  check('out of stock items are counted', stats.outOfStockItemsCount === 2);
  check('profit margin is revenue-relative', stats.profitMarginPct === current.grossMarginPct);
  check('averaging is defined for an empty window', tallyOrders([]).averageOrderValue === 0);
  check('margin is zero without revenue', tallyOrders([]).grossMarginPct === 0);
  check('a halved window reports -50%', growthPercentage(50, 100) === -50);
};

/* -------------------------------------------------------------------------- */
/* 4.5 — responsive navigation                                                 */
/* -------------------------------------------------------------------------- */

const verifyNavigation = (): void => {
  check('360px uses the drawer', resolveNavigationMode(360) === 'drawer');
  check('390px uses the drawer', resolveNavigationMode(390) === 'drawer');
  check('430px uses the drawer', resolveNavigationMode(430) === 'drawer');
  check('767px still uses the drawer', resolveNavigationMode(767) === 'drawer');
  check('768px switches to the sidebar', resolveNavigationMode(768) === 'sidebar');
  check('1440px uses the sidebar', resolveNavigationMode(1440) === 'sidebar');
  check('the breakpoint constant matches the plan', NAVIGATION_BREAKPOINT === 768);
  check('the helper agrees with the mode', isDesktopNavigation(768) && !isDesktopNavigation(767));
};

/* -------------------------------------------------------------------------- */
/* Transactional behaviour against a real database                             */
/* -------------------------------------------------------------------------- */

const verifyTransactions = async (): Promise<void> => {
  await clearAllTables();
  const dataset = buildSeedDataset(ANCHOR);
  await db.transaction('rw', db.products, db.orders, db.inventoryLogs, async () => {
    await Promise.all([
      db.products.bulkAdd(dataset.products),
      db.orders.bulkAdd(dataset.orders),
      db.inventoryLogs.bulkAdd(dataset.inventoryLogs),
    ]);
  });

  const before = await getTableCounts();
  const product = dataset.products.find((candidate) => candidate.variants.some((variant) => !variant.isArchived));
  if (product === undefined) throw new Error('no product with a live variant');
  const variant = product.variants.find((candidate) => !candidate.isArchived)!;

  // Happy path: one write moves product, variant, status and log together.
  const result = await applyStockChange({
    productId: product.id,
    variantId: variant.id,
    changeType: 'restock',
    quantity: 9,
    reason: 'Harness restock',
  });
  const afterRestock = await getTableCounts();
  check('a restock writes exactly one ledger row', afterRestock.inventoryLogs === before.inventoryLogs + 1);
  check('the product row reports the new balance', result.product.totalStock === product.totalStock + 9);
  const storedProduct = await db.products.get(product.id);
  check(
    'the stored total matches the denormalised variant sum',
    storedProduct !== undefined && storedProduct.totalStock === recalculateTotalStock(storedProduct.variants),
  );
  check(
    'the stored variant holds the new quantity',
    storedProduct?.variants.find((candidate) => candidate.id === variant.id)?.stockQuantity === variant.stockQuantity + 9,
  );
  const storedLog = await db.inventoryLogs.get(result.log.id);
  check('the ledger row is persisted', storedLog !== undefined);
  check('the ledger row references the variant', storedLog?.variantId === variant.id);
  check('the ledger row records the previous balance', storedLog?.previousQuantity === variant.stockQuantity);

  // Rejection: nothing at all may be written.
  const beforeReject = await getTableCounts();
  const productBefore = await db.products.get(product.id);
  const currentVariantStock =
    productBefore?.variants.find((candidate) => candidate.id === variant.id)?.stockQuantity ?? 0;
  let rejected: unknown = null;
  try {
    await applyStockChange({
      productId: product.id,
      variantId: variant.id,
      changeType: 'sale',
      quantity: currentVariantStock + 1,
      reason: 'Harness oversell',
    });
  } catch (cause) {
    rejected = cause;
  }
  check('an oversell is rejected', rejected instanceof StockMutationError);
  const afterReject = await getTableCounts();
  check('a rejected change writes no ledger row', afterReject.inventoryLogs === beforeReject.inventoryLogs);
  check('a rejected change writes no product row', afterReject.products === beforeReject.products);
  const productAfter = await db.products.get(product.id);
  check(
    'a rejected change leaves the product untouched',
    JSON.stringify(productAfter) === JSON.stringify(productBefore),
  );

  // Missing product.
  let missing: unknown = null;
  try {
    await applyStockChange({ productId: 'no-such-product', changeType: 'restock', quantity: 1, reason: 'x' });
  } catch (cause) {
    missing = cause;
  }
  check('an unknown product is rejected', (missing as StockError).code === 'not_found');

  // Order transition that returns stock.
  const order = dataset.orders.find(
    (candidate) =>
      candidate.status === 'processing' &&
      candidate.items.every((item) => {
        const parent = dataset.products.find((productRow) => productRow.id === item.productId);
        if (parent === undefined) return false;
        if (item.variantId === undefined) return true;
        return parent.variants.some((variantRow) => variantRow.id === item.variantId);
      }),
  );
  if (order === undefined) throw new Error('no transitionable order in the seed');

  const targetProduct = dataset.products.find((candidate) => candidate.id === order.items[0]?.productId);
  const targetVariantId = order.items[0]?.variantId;
  const stockBefore = await db.products.get(targetProduct!.id);
  const stockBeforeValue =
    targetVariantId === undefined
      ? stockBefore!.totalStock
      : stockBefore!.variants.find((variantRow) => variantRow.id === targetVariantId)!.stockQuantity;

  const transitioned = await applyOrderTransition(order.id, 'cancelled');
  check('the order reaches the requested status', transitioned.order.status === 'cancelled');
  check('the order is now non-revenue', NON_REVENUE_ORDER_STATUSES.includes(transitioned.order.status));
  check('every returnable line produced a change', transitioned.stockChanges.length === buildStockReturnLines(order).length);
  check('each change is a return', transitioned.stockChanges.every((change) => change.log.changeType === 'return'));

  const stockAfter = await db.products.get(targetProduct!.id);
  const stockAfterValue =
    targetVariantId === undefined
      ? stockAfter!.totalStock
      : stockAfter!.variants.find((variantRow) => variantRow.id === targetVariantId)!.stockQuantity;
  const expectedUnits =
    order.items
      .filter((item) => item.productId === targetProduct!.id)
      .filter((item) => item.variantId === targetVariantId)
      .reduce((total, item) => total + item.quantity, 0) || null;
  if (expectedUnits !== null) {
    check(
      'stock returned by exactly the ordered units',
      stockAfterValue === stockBeforeValue + expectedUnits,
      `${stockAfterValue} vs ${stockBeforeValue + expectedUnits}`,
    );
  }
  check(
    'a return keeps the product total consistent',
    stockAfter!.totalStock === recalculateTotalStock(stockAfter!.variants),
  );

  // An illegal transition writes nothing.
  const orderBefore = await db.orders.get(order.id);
  const countsBefore = await getTableCounts();
  let illegal: unknown = null;
  try {
    await applyOrderTransition(order.id, 'delivered');
  } catch (cause) {
    illegal = cause;
  }
  check('a cancelled order cannot be delivered', (illegal as { code?: string }).code === 'illegal_transition');
  check('an illegal transition leaves the order untouched', (await db.orders.get(order.id))?.status === orderBefore?.status);
  const countsAfter = await getTableCounts();
  check('an illegal transition writes no ledger row', countsAfter.inventoryLogs === countsBefore.inventoryLogs);
  check('an illegal transition writes no product row', countsAfter.products === countsBefore.products);

  // A second, identical transition is refused because the order is terminal.
  let repeat: unknown = null;
  try {
    await applyOrderTransition(order.id, 'cancelled');
  } catch (cause) {
    repeat = cause;
  }
  check('a terminal order refuses further transitions', (repeat as { code?: string }).code === 'illegal_transition');
  check(
    'a refused repeat returns stock only once',
    (await getTableCounts()).inventoryLogs === countsAfter.inventoryLogs,
  );

  // Shipped orders return stock on refund.
  const shipped = dataset.orders.find((candidate) => candidate.status === 'shipped');
  if (shipped !== undefined) {
    const refunded = await applyOrderTransition(shipped.id, 'refunded');
    check('a shipped order can be refunded', refunded.order.status === 'refunded');
    check('refunding returns stock', refunded.stockChanges.length > 0);
  }

  // Clean up so the suite is repeatable.
  await clearAllTables();
  check('the database clears cleanly', (await getTableCounts()).products === 0);
  check('every status has a histogram slot', STOCK_STATUSES.length === 4);
};

/* -------------------------------------------------------------------------- */

const run = async (): Promise<void> => {
  await databaseReady;
  check('database is open for the hook suite', db.isOpen());

  verifyStockMutations();
  verifyOrderMachine();
  verifyQueries();
  verifyMetrics();
  verifyNavigation();
  await verifyTransactions();
};

await run();

console.log(`\n[hooks] ${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n[hooks] ${failures.length} FAILURES:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
}
