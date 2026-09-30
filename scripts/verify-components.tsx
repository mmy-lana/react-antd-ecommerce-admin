/**
 * Component render harness.
 *
 * Type checking proves a component compiles; it does not prove it renders. These
 * checks mount every primitive and feature component with representative props
 * through `react-dom/server`, which executes the full render path (hook order,
 * prop plumbing, undefined access, Ant Design slot contracts) without needing a
 * browser.
 *
 * The assertions also pin down the accessibility contract the plan requires:
 * status badges expose a label-bearing accessible name, trend indicators keep
 * the visible text inside the accessible name, and loading states announce
 * themselves as busy.
 *
 * Run with `pnpm run verify:domain`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { Form } from 'antd';
import type { FC, ReactElement } from 'react';

import { buildSeedDataset } from '../src/shared/db/seedData';
import { chartPalette } from '../src/app/theme/tokens';
import { CategoryBreakdownChart } from '../src/features/dashboard/components/CategoryBreakdownChart';
import {
  MAX_LEGEND_SLICES,
  OTHER_CATEGORY_LABEL,
  buildCategoryDonutConfig,
  buildCategorySlices,
} from '../src/features/dashboard/components/CategoryBreakdownChart';
import { KPIOverviewGrid, buildKpiCards } from '../src/features/dashboard/components/KPIOverviewGrid';
import {
  DEFAULT_RECENT_ORDER_COUNT,
  RecentOrdersSnapshot,
  selectRecentOrders,
} from '../src/features/dashboard/components/RecentOrdersSnapshot';
import {
  RevenueTimeSeriesChart,
  buildRevenueChartConfig,
  clampZoomWindow,
  formatSeriesValue,
  panZoomWindow,
  resolvePercentFromZoom,
  resolveZoomFromPercent,
  sliceByZoom,
} from '../src/features/dashboard/components/RevenueTimeSeriesChart';
import { InventoryTable, resolveColumnDensity } from '../src/features/inventory/components/InventoryTable';
import {
  MAX_VARIANTS_PER_PRODUCT,
  ProductFormFields,
  validateProductForm,
  type ProductFormValues,
} from '../src/features/inventory/components/ProductFormDrawer';
import { StockFilterToolbar, hasActiveInventoryFilters } from '../src/features/inventory/components/StockFilterToolbar';
import {
  MAX_ADJUSTMENT_QUANTITY,
  MAX_REASON_LENGTH,
  StockAdjustmentForm,
  StockAdjustmentModal,
  resolveSignedDelta,
  validateAdjustment,
  type AdjustmentInput,
} from '../src/features/inventory/components/StockAdjustmentModal';
import {
  OrderDetailBody,
  OrderDetailDrawer,
  OrderTransitionBar,
} from '../src/features/sales/components/OrderDetailDrawer';
import { OrdersTable, buildTransitionOptions } from '../src/features/sales/components/OrdersTable';
import {
  ALL_TIME_START,
  SalesDateRangePicker,
  matchPreset,
  resolvePresetRange,
} from '../src/features/sales/components/SalesDateRangePicker';
import { buildRouteHash,
  parseRouteFromHash,
  Router,
  ROUTE_PATHS,
  ROUTE_TITLES,
} from '../src/app/Router';
import { EmptyStateView } from '../src/shared/components/feedback/EmptyStateView';
import { ErrorBoundary } from '../src/shared/components/feedback/ErrorBoundary';
import {
  ChartSkeleton,
  KpiSkeletonGrid,
  SkeletonBoard,
  TableSkeleton,
} from '../src/shared/components/feedback/SkeletonBoard';
import { MetricCard } from '../src/shared/components/primitives/MetricCard';
import { ResponsiveContainer } from '../src/shared/components/primitives/ResponsiveContainer';
import { StatusBadge } from '../src/shared/components/primitives/StatusBadge';
import { TrendIndicator } from '../src/shared/components/primitives/TrendIndicator';
import { differenceInUtcDays, enumerateBucketKeys, toUtcDayjs } from '../src/shared/utils/dateMath';
import {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  allowedOrderTransitions,
  isRevenueRecognizedOrder,
  type CategorySalesPoint,
  type Order,
  type Product,
  type KPIStats,
  type SalesTimeSeriesPoint,
} from '../src/shared/types';
import { AntDAppProviderHarness } from './harness/AntDAppProviderHarness';

const failures: string[] = [];
let assertions = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const render = (label: string, element: ReactElement): string => {
  try {
    return renderToStaticMarkup(AntDAppProviderHarness(element));
  } catch (error) {
    assertions += 1;
    failures.push(`${label} threw during render — ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
};

/* -------------------------------------------------------------------------- */
/* Responsive container                                                        */
/* -------------------------------------------------------------------------- */

const containerMarkup = render(
  'ResponsiveContainer',
  <ResponsiveContainer>
    <span>content</span>
  </ResponsiveContainer>,
);
check('ResponsiveContainer renders children', containerMarkup.includes('content'));
check('ResponsiveContainer publishes its band', containerMarkup.includes('data-breakpoint='));
check('ResponsiveContainer is not a live region', !containerMarkup.includes('aria-live'));

const semanticMarkup = render(
  'ResponsiveContainer as section',
  <ResponsiveContainer as="section">
    <span>scoped</span>
  </ResponsiveContainer>,
);
check('ResponsiveContainer honours the semantic element', semanticMarkup.includes('<section'));

/* -------------------------------------------------------------------------- */
/* Status badges                                                               */
/* -------------------------------------------------------------------------- */

const stockBadge = render(
  'StatusBadge stock',
  <StatusBadge domain="stock" status="low_stock" />,
);
check('stock badge shows its label', decodeEntities(stockBadge).includes('Low Stock'));
check(
  'stock badge accessible name carries the kind',
  stockBadge.includes('aria-label="Stock status: Low Stock"'),
  stockBadge.slice(0, 200),
);
check('status dot is decorative', stockBadge.includes('aria-hidden="true"'));

// UI-CSS-01: the pill must declare its own height and opt out of flex
// stretching, or a table row turns it into a tall vertical sausage.
check('the badge declares an explicit height', /height:\s*26px/.test(stockBadge), stockBadge.slice(0, 400));
check('the badge caps its own height', /max-height:\s*26px/.test(stockBadge));
check('the badge opts out of flex stretching', /align-self:\s*center/.test(stockBadge));
check('the badge uses border-box so the border stays inside', /box-sizing:\s*border-box/.test(stockBadge));
check('the badge centres its own content', /justify-content:\s*center/.test(stockBadge));
check('the badge is a flex container', /display:\s*inline-flex/.test(stockBadge));

const smallBadge = render('StatusBadge small', <StatusBadge domain="stock" status="low_stock" size="small" />);
check('the small badge is shorter than the default', /height:\s*22px/.test(smallBadge), smallBadge.slice(0, 400));
check('the small badge is capped at 22px', /max-height:\s*22px/.test(smallBadge));

// An interactive badge is a 44px touch target, so it must not inherit the
// read-only cap — a `max-height` smaller than `min-height` silently loses.
const touchBadge = render(
  'StatusBadge interactive',
  <StatusBadge domain="order" status="pending" onClick={() => undefined} />,
);
check('the interactive badge keeps its touch target', /min-height:\s*(44|36)px/.test(touchBadge), touchBadge.slice(0, 400));
check('the interactive badge is not height-capped', !/max-height:\s*2\dpx/.test(touchBadge), touchBadge.slice(0, 400));
check('the interactive badge still opts out of stretching', /align-self:\s*center/.test(touchBadge));

const orderBadge = render(
  'StatusBadge order',
  <StatusBadge domain="order" status="refunded" />,
);
check('order badge shows its label', decodeEntities(orderBadge).includes('Refunded'));
check(
  'order badge accessible name carries the kind',
  orderBadge.includes('aria-label="Order status: Refunded"'),
);

const countedBadge = render(
  'StatusBadge with count',
  <StatusBadge domain="stock" status="out_of_stock" count={12} />,
);
check('counted badge renders the count', countedBadge.includes('12'));

const clickableBadge = render(
  'StatusBadge interactive',
  <StatusBadge domain="stock" status="in_stock" onClick={() => undefined} />,
);
check('interactive badge is a real button', clickableBadge.includes('<button'));
check('interactive badge is typed as a button', clickableBadge.includes('type="button"'));

/* -------------------------------------------------------------------------- */
/* Trend indicator + metric card                                               */
/* -------------------------------------------------------------------------- */

const risingTrend = render('TrendIndicator up', <TrendIndicator value={12.5} comparisonLabel="vs last 30 days" />);
check('positive trend is signed', decodeEntities(risingTrend).includes('+12.5%'));
check('trend marks its direction', risingTrend.includes('data-direction="up"'));

const fallingTrend = render('TrendIndicator down', <TrendIndicator value={-4.25} />);
check('negative trend uses a true minus sign', decodeEntities(fallingTrend).includes('−4.3%'));

const flatTrend = render('TrendIndicator flat', <TrendIndicator value={0} />);
check('flat trend has no arrow direction', flatTrend.includes('data-direction="flat"'));

const invertedTrend = render(
  'TrendIndicator positiveIsGood=false',
  <TrendIndicator value={8} positiveIsGood={false} />,
);
check(
  'inverted metric marks a rise as bad',
  invertedTrend.includes('data-tone') === false && invertedTrend.includes('#b91c1c'),
  invertedTrend.slice(0, 240),
);

const metricMarkup = render(
  'MetricCard',
  <MetricCard
    title="Total Revenue"
    value="$487,259.68"
    trend={12.5}
    trendComparisonLabel="vs prev"
    secondaryLabel="100 orders"
    accent="primary"
  />,
);
check('metric card renders its title', metricMarkup.includes('Total Revenue'));
check('metric card renders its value', decodeEntities(metricMarkup).includes('$487,259.68'));
check('metric card renders the trend', decodeEntities(metricMarkup).includes('+12.5%'));
check('metric card exposes a value hook', metricMarkup.includes('data-testid="metric-value-Total Revenue"'));
check('metric card accent rail is decorative', metricMarkup.includes('aria-hidden="true"'));

const clickableMetric = render('MetricCard clickable', <MetricCard title="Low Stock" value={4} onClick={() => undefined} />);
check('clickable metric is keyboard reachable', clickableMetric.includes('tabindex="0"'));
check('clickable metric is announced as a button', clickableMetric.includes('role="button"'));

const loadingMetric = render('MetricCard loading', <MetricCard title="Revenue" value="$0" loading />);
check('loading metric announces its state', loadingMetric.includes('aria-busy="true"'));

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

const emptyMarkup = render('EmptyStateView', <EmptyStateView title="No products" description="Add one to begin" />);
check('empty state renders its title', emptyMarkup.includes('No products'));
check('empty state renders its description', emptyMarkup.includes('Add one to begin'));

const emptyWithAction = render(
  'EmptyStateView with action',
  <EmptyStateView title="Nothing" action={<button type="button">Create</button>} />,
);
check('empty state renders its action', emptyWithAction.includes('Create'));

const kpiSkeleton = render('KpiSkeletonGrid', <KpiSkeletonGrid count={4} />);
check('kpi skeleton announces busy state', kpiSkeleton.includes('aria-busy="true"'));
check(
  'kpi skeleton reserves one placeholder row per tile',
  (kpiSkeleton.match(/ant-skeleton-input/g) ?? []).length >= 12,
  `${(kpiSkeleton.match(/ant-skeleton-input/g) ?? []).length} skeleton inputs`,
);

const chartSkeleton = render('ChartSkeleton', <ChartSkeleton title="Revenue trend" />);
check('chart skeleton reserves height', chartSkeleton.includes('height:320px'), 'chart height not reserved');
check('chart skeleton labels itself', chartSkeleton.includes('aria-label='));

const tableSkeleton = render('TableSkeleton', <TableSkeleton rows={6} />);
check('table skeleton announces busy state', tableSkeleton.includes('aria-busy="true"'));

const boardMarkup = render('SkeletonBoard', <SkeletonBoard variant="dashboard" />);
check('skeleton board composes kpi and chart fallbacks', boardMarkup.includes('aria-busy="true"'));

const boundaryMarkup = render('ErrorBoundary', <ErrorBoundary label="Inventory">child</ErrorBoundary>);
check('error boundary renders its children while healthy', boundaryMarkup.includes('child'));
check('error boundary hides the fallback while healthy', !boundaryMarkup.includes('could not be displayed'));

/* -------------------------------------------------------------------------- */
/* Router                                                                      */
/* -------------------------------------------------------------------------- */

check('router parses a known route', parseRouteFromHash('#/sales') === 'sales');
check('router parses a nested fragment', parseRouteFromHash('#/inventory/42') === 'inventory');
check('router tolerates a missing prefix', parseRouteFromHash('dashboard') === 'dashboard');
check('router falls back on an unknown route', parseRouteFromHash('#/nope') === 'dashboard');
check('router falls back on an empty hash', parseRouteFromHash('') === 'dashboard');
check('router falls back on a bare slash', parseRouteFromHash('#/') === 'dashboard');
check('router builds canonical hashes', buildRouteHash('inventory') === '#/inventory');
check(
  'every route has a document title',
  ROUTE_PATHS.every((route) => ROUTE_TITLES[route].length > 0),
);

const routerMarkup = render(
  'Router',
  <Router renderView={(route) => <span>{`view:${route}`}</span>} />,
);
check('router renders the requested view', routerMarkup.includes('view:dashboard'));
check('router exposes a focusable main landmark', routerMarkup.includes('id="main-content"'));
check('router main landmark is programmatically focusable', routerMarkup.includes('tabindex="-1"'));

/* -------------------------------------------------------------------------- */
/* Phase 3 — feature components                                                 */
/* -------------------------------------------------------------------------- */

const FIXTURE_NOW = new Date('2026-03-01T09:00:00.000Z');
const dataset = buildSeedDataset(FIXTURE_NOW);
const sampleProduct = dataset.products.find((product) => product.variants.length > 0) ?? dataset.products[0];
const sampleVariant = sampleProduct?.variants[0];
const firstOrder = dataset.orders[0];
if (firstOrder === undefined) throw new Error('seed dataset produced no orders');
const sampleOrder: Order = firstOrder;

check('seed dataset is non-empty', dataset.products.length > 0 && dataset.orders.length > 0);

/* -- Inventory column density contract (plan Task 3.1) --------------------- */

const compactDensity = resolveColumnDensity(390);
check('390px hides category', !compactDensity.showCategory);
check('390px hides price', !compactDensity.showPrice);
check('390px keeps status', compactDensity.showStatus);
check('390px density is compact', compactDensity.density === 'compact');

const tabletDensity = resolveColumnDensity(767);
check('767px is tablet', tabletDensity.density === 'tablet');
check('767px keeps category', tabletDensity.showCategory);
check('767px hides brand', !tabletDensity.showBrand);
check('767px hides margin', !tabletDensity.showMargin);

const desktopDensity = resolveColumnDensity(768);
check('768px is desktop', desktopDensity.density === 'desktop');
check('768px shows brand', desktopDensity.showBrand);
check('768px shows margin', desktopDensity.showMargin);
check('1440px is desktop', resolveColumnDensity(1440).density === 'desktop');

/* -- Stock filter predicates ------------------------------------------------ */

check('no filters means inactive', !hasActiveInventoryFilters({ category: 'all', stockStatus: 'all', searchQuery: '' }));
check('whitespace search is inactive', !hasActiveInventoryFilters({ category: 'all', stockStatus: 'all', searchQuery: '   ' }));
check('category activates filters', hasActiveInventoryFilters({ category: 'Audio', stockStatus: 'all', searchQuery: '' }));
check('status activates filters', hasActiveInventoryFilters({ category: 'all', stockStatus: 'low_stock', searchQuery: '' }));
check('search activates filters', hasActiveInventoryFilters({ category: 'all', stockStatus: 'all', searchQuery: 'aura' }));

/* -- Adjustment guards (plan Task 3.2) ------------------------------------- */

const baseAdjustment = { changeType: 'restock' as const, quantity: 10, currentQuantity: 5, reason: 'Supplier delivery' };
check('valid restock is accepted', validateAdjustment(baseAdjustment).valid);
check('restock raises the balance', validateAdjustment(baseAdjustment).resultingQuantity === 15);
check('zero change is rejected', !validateAdjustment({ ...baseAdjustment, quantity: 0 }).valid);
check('fractional change is rejected', !validateAdjustment({ ...baseAdjustment, quantity: 2.5 }).valid);
check(
  'removing more than is on hand is rejected',
  !validateAdjustment({ ...baseAdjustment, changeType: 'sale', currentQuantity: 3, quantity: 10 }).valid,
);
check(
  'the rejection names the units on hand',
  (validateAdjustment({ ...baseAdjustment, changeType: 'sale', currentQuantity: 3, quantity: 10 }).message ?? '').includes('3 units'),
);
check('oversized change is rejected', !validateAdjustment({ ...baseAdjustment, quantity: MAX_ADJUSTMENT_QUANTITY + 1 }).valid);
check('short reason is rejected', !validateAdjustment({ ...baseAdjustment, reason: 'ab' }).valid);
check('blank reason is rejected', !validateAdjustment({ ...baseAdjustment, reason: '     ' }).valid);
check('long reason is rejected', !validateAdjustment({ ...baseAdjustment, reason: 'x'.repeat(MAX_REASON_LENGTH + 1) }).valid);
check('restock adds to the balance', resolveSignedDelta('restock', 3) === 3);
check('return adds to the balance', resolveSignedDelta('return', 3) === 3);
check('sale signs negative', resolveSignedDelta('sale', 3) === -3);
check('damage signs negative', resolveSignedDelta('damage', 3) === -3);
check('a magnitude ignores a typed minus sign', resolveSignedDelta('restock', -3) === 3);
check('an adjustment keeps the operator sign', resolveSignedDelta('adjustment', -3) === -3);
check('an adjustment keeps a positive sign', resolveSignedDelta('adjustment', 3) === 3);
check(
  'a signed correction can remove stock',
  validateAdjustment({ ...baseAdjustment, changeType: 'adjustment', currentQuantity: 10, quantity: -4 }).resultingQuantity === 6,
);
check(
  'a signed correction can add stock',
  validateAdjustment({ ...baseAdjustment, changeType: 'adjustment', currentQuantity: 10, quantity: 4 }).resultingQuantity === 14,
);
check(
  'damage cannot drive stock negative',
  !validateAdjustment({ ...baseAdjustment, changeType: 'damage', currentQuantity: 2, quantity: 3 }).valid,
);
check('a non-finite quantity yields no delta', resolveSignedDelta('restock', Number.NaN) === 0);

/* -- Product form guards --------------------------------------------------- */

const validForm = {
  name: 'Aurora Headphones',
  sku: 'AUD-1',
  category: PRODUCT_CATEGORIES[0],
  brand: PRODUCT_BRANDS[0],
  description: '',
  basePrice: 10,
  baseCost: 2,
  safetyStockThreshold: 3,
  status: 'in_stock' as const,
  tags: [],
  variants: [{ name: 'Black', sku: 'AUD-1-B', price: 10, costPrice: 2, stockQuantity: 4, safetyStockThreshold: 1 }],
};
check('a complete product passes validation', validateProductForm(validForm).length === 0);
check(
  'a product needs a name',
  validateProductForm({ ...validForm, name: '  ' }).some((problem) => problem.includes('name is required')),
);
check(
  'a product needs one named variant',
  validateProductForm({ ...validForm, variants: [] }).some((problem) => problem.includes('at least one variant')),
);
check(
  'duplicate variant SKUs are rejected',
  validateProductForm({
    ...validForm,
    variants: [validForm.variants[0], { ...validForm.variants[0], name: 'White' }],
  }).some((problem) => problem.includes('used more than once')),
);
check(
  'a negative price is rejected',
  validateProductForm({ ...validForm, basePrice: -1 }).some((problem) => problem.includes('negative')),
);
check(
  'a nameless variant is ignored rather than fatal',
  validateProductForm({
    ...validForm,
    variants: [...validForm.variants, { name: '', sku: '', price: 0, costPrice: 0, stockQuantity: 0, safetyStockThreshold: 0 }],
  }).length === 0,
);
check(
  'too many variants are rejected',
  validateProductForm({
    ...validForm,
    variants: Array.from({ length: MAX_VARIANTS_PER_PRODUCT + 1 }, (_, index) => ({
      ...validForm.variants[0],
      name: `V${index}`,
      sku: `S${index}`,
    })),
  }).some((problem) => problem.includes('at most')),
);

/* -- Zoom window (plan Task 3.3) ------------------------------------------- */

check('empty data clamps to a degenerate window', clampZoomWindow({ startIndex: 5, endIndex: 9 }, 0).endIndex === 0);
check('window clamps to the last index', clampZoomWindow({ startIndex: 99, endIndex: 200 }, 10).endIndex === 9);
check('window clamps the start to zero', clampZoomWindow({ startIndex: -5, endIndex: 4 }, 10).startIndex === 0);
check('end never precedes start', clampZoomWindow({ startIndex: 7, endIndex: 2 }, 10).startIndex === 7);
check('slicing is inclusive at both ends', sliceByZoom([1, 2, 3, 4, 5], { startIndex: 1, endIndex: 3 }).join(',') === '2,3,4');
check('full window slices everything', sliceByZoom([1, 2, 3], clampZoomWindow({}, 3)).length === 3);

const zoomRoundTrip = resolveZoomFromPercent(resolvePercentFromZoom({ startIndex: 2, endIndex: 7 }, 10), 10);
check('percent round-trips a window', zoomRoundTrip.startIndex === 2 && zoomRoundTrip.endIndex === 7, JSON.stringify(zoomRoundTrip));
check('full zoom percent is the whole range', resolvePercentFromZoom({ startIndex: 0, endIndex: 9 }, 10).join(',') === '0,100');
check('panning left clamps at zero', panZoomWindow({ startIndex: 1, endIndex: 5 }, 10, -4).startIndex === 0);
check('panning right clamps at the end', panZoomWindow({ startIndex: 5, endIndex: 9 }, 10, 4).endIndex === 9);

/* -- Time series chart config --------------------------------------------- */

const timeSeries: SalesTimeSeriesPoint[] = enumerateBucketKeys(
  { startDate: '2026-02-01T00:00:00.000Z', endDate: '2026-02-05T00:00:00.000Z' },
  'day',
).map((date) => ({ date, revenue: 100, profit: 40, ordersCount: 5 }));

const revenueConfig = buildRevenueChartConfig({
  data: timeSeries,
  series: 'revenue',
  interval: 'day',
  width: 800,
  height: 320,
});
check('area chart binds x to the bucket', revenueConfig.xField === 'date');
check('area chart binds y to the series', revenueConfig.yField === 'revenue');
check('area chart copies the data', Array.isArray(revenueConfig.data) && (revenueConfig.data as unknown[]).length === 5);
check('area chart is not legended', revenueConfig.legend === false);
check(
  'area chart stroke comes from the token palette',
  (revenueConfig.style as { stroke: string }).stroke === chartPalette[0],
);
check('area chart formats currency on the y axis', typeof revenueConfig.scale === 'object');

const ordersConfig = buildRevenueChartConfig({
  data: timeSeries,
  series: 'ordersCount',
  interval: 'day',
  width: 800,
  height: 320,
});
check('the count series binds its own y field', ordersConfig.yField === 'ordersCount');
check('counts format as integers', formatSeriesValue('ordersCount', 1234) === '1,234');
check('currency series format as money', formatSeriesValue('revenue', 1234.5).startsWith('$'));

/* -- Category donut --------------------------------------------------------- */

const categoryPoints: CategorySalesPoint[] = Array.from({ length: 11 }, (_, index) => ({
  category: `Category ${String(index).padStart(2, '0')}`,
  revenue: (11 - index) * 100,
  unitsSold: 10 - index,
  percentage: 0,
}));

const slices = buildCategorySlices(categoryPoints);
check('slices are capped', slices.length === MAX_LEGEND_SLICES + 1);
check('the tail is grouped', slices[slices.length - 1].category === OTHER_CATEGORY_LABEL);
check(
  'the grouped slice sums the tail',
  slices[slices.length - 1].revenue === categoryPoints.slice(MAX_LEGEND_SLICES).reduce((sum, p) => sum + p.revenue, 0),
);
check('slices are sorted by revenue', slices[0].revenue >= slices[1].revenue);
check('an empty dataset yields no slices', buildCategorySlices([]).length === 0);
check('zero-revenue categories are dropped', buildCategorySlices([
  { category: 'Empty', revenue: 0, unitsSold: 0, percentage: 0 },
]).length === 0);
check('donut has an inner hole', buildCategoryDonutConfig({ slices, width: 320, height: 320, totalRevenue: 1 }).innerRadius === 0.62);
check('donut hides the legend', buildCategoryDonutConfig({ slices, width: 320, height: 320, totalRevenue: 1 }).legend === false);

/* -- KPI cards -------------------------------------------------------------- */

const kpiStats: KPIStats = {
  totalRevenue: 487259.68,
  totalOrders: 100,
  ordersGrowthPct: -3.5,
  averageOrderValue: 4872.6,
  grossProfit: 121814.92,
  profitMarginPct: 25,
  revenueGrowthPct: 12.5,
  lowStockItemsCount: 4,
  outOfStockItemsCount: 2,
};

const kpiCards = buildKpiCards(kpiStats, true);
check('six KPI cards are produced', kpiCards.length === 6);
check('kpi keys are the expected set', kpiCards.map((card) => card.key).join(',') ===
  'totalRevenue,revenueGrowthPct,grossProfit,profitMarginPct,averageOrderValue,stockAlerts');
check('revenue card carries the growth trend', kpiCards[0].trend === 12.5);
check('growth card is signed', kpiCards[1].value.startsWith('+'));
// UX-METRIC-01: the card's own value is already the growth percentage, so a
// `trend` would print the identical number a second time underneath it.
check('growth card does not repeat its own percentage as a trend', kpiCards[1].trend === undefined);
check('growth card keeps its comparison hint', kpiCards[1].hint === 'vs previous period');
check(
  'no other card claims a percentage identical to its own value',
  kpiCards.every((card) => card.trend === undefined || !card.value.includes(String(card.trend))),
);
check('profit card shows the margin', kpiCards[2].secondaryLabel?.includes('25') === true);
check('stock alert card counts both buckets', kpiCards[5].value === '6');
check('stock alert card is navigable', kpiCards[5].interactive === true);
check('every KPI card has a spoken description', kpiCards.every((card) => card.ariaDescription.length > 0));

const noComparisonCards = buildKpiCards(kpiStats, false);
check('growth is withheld without a comparison period', noComparisonCards[1].value === '—');
check('no fabricated trend is emitted', noComparisonCards[0].trend === undefined);
check('growth card explains the missing comparison', noComparisonCards[1].hint === 'No earlier period to compare');
check('growth card has no trend without a comparison', noComparisonCards[1].trend === undefined);

/* -- Order transitions (plan Task 3.5) ------------------------------------- */

const pendingOrder = dataset.orders.find((order) => order.status === 'pending');
if (pendingOrder) {
  const options = buildTransitionOptions(pendingOrder);
  const legal = allowedOrderTransitions(pendingOrder.status);
  check(
    'transition options mirror the state machine exactly',
    options.map((option) => option.status).join(',') === legal.join(','),
    `got ${options.map((option) => option.status).join(',')} want ${legal.join(',')}`,
  );
  check('no transition is offered to the same state', !options.some((option) => option.status === pendingOrder.status));
  check(
    'every revenue-reversing target is flagged as such',
    options.every((option) => option.reversesRevenue === !isRevenueRecognizedOrder(option.status)),
  );
}
const cancelledOrder = dataset.orders.find((order) => order.status === 'cancelled');
if (cancelledOrder) {
  check('a cancelled order has no transitions', buildTransitionOptions(cancelledOrder).length === 0);
}
const shippedOrder = dataset.orders.find((order) => order.status === 'shipped');
if (shippedOrder) {
  const options = buildTransitionOptions(shippedOrder);
  check(
    'refunding a shipped order is flagged as reversing revenue',
    options.find((option) => option.status === 'refunded')?.reversesRevenue === true,
  );
  check('a refund target is marked dangerous', options.find((option) => option.status === 'refunded')?.danger === true);
  check('delivery from shipped is not marked dangerous', options.find((option) => option.status === 'delivered')?.danger === false);
}

/* -- Date presets (UTC boundaries) ----------------------------------------- */

const last30 = resolvePresetRange('30d', FIXTURE_NOW);
check('30d preset spans 30 UTC days', differenceInUtcDays(last30.endDate, last30.startDate) === 29);
check('30d preset ends on today in UTC', toUtcDayjs(last30.endDate).isSame(FIXTURE_NOW, 'day'));
check('30d preset starts 29 days back', differenceInUtcDays(FIXTURE_NOW.toISOString(), last30.startDate) === 29);
check('7d preset spans 7 UTC days', differenceInUtcDays(resolvePresetRange('7d', FIXTURE_NOW).endDate, resolvePresetRange('7d', FIXTURE_NOW).startDate) === 6);
check('year to date starts on Jan 1', toUtcDayjs(resolvePresetRange('ytd', FIXTURE_NOW).startDate).utc().month() === 0);
check('all time starts at the epoch', resolvePresetRange('all', FIXTURE_NOW).startDate === ALL_TIME_START);
check('a 30d range matches the 30d preset', matchPreset(last30, FIXTURE_NOW) === '30d');
check('an arbitrary range falls back to custom', matchPreset(resolvePresetRange('7d', FIXTURE_NOW), FIXTURE_NOW) === '7d');
check(
  'a hand-built range is custom',
  matchPreset({ startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-01-15T00:00:00.000Z' }, FIXTURE_NOW) === 'custom',
);

/* -- Recent orders snapshot ------------------------------------------------ */

const recent = selectRecentOrders(dataset.orders, 5);
check('recent orders are capped', recent.length === 5);
check('recent orders are newest first', recent[0].createdAt >= recent[4].createdAt);
check('recent ordering is stable', selectRecentOrders(dataset.orders, 5).map((o) => o.id).join(',') === recent.map((o) => o.id).join(','));
check('a zero limit returns nothing', selectRecentOrders(dataset.orders, 0).length === 0);

/* -------------------------------------------------------------------------- */
/* Phase 3 — component rendering                                               */
/* -------------------------------------------------------------------------- */

/**
 * Stand-in for the plotting runtime: the harness only needs to prove the chart
 * components hand a well-formed config to their renderer.
 */
/**
 * Form instances have to be created by a component, so the harness mounts thin
 * wrappers that own the instance and hand it to the portal-free form.
 */
const AdjustmentFormHarness: FC<{
  product: Product | null;
  variantId?: string;
  currentQuantity: number;
  error?: string;
}> = ({ product, variantId, currentQuantity, error }) => {
  const [form] = Form.useForm<AdjustmentInput>();
  return (
    <StockAdjustmentForm
      product={product}
      {...(variantId ? { variantId } : {})}
      form={form}
      currentQuantity={currentQuantity}
      onFinish={() => undefined}
      {...(error ? { error } : {})}
    />
  );
};

const ProductFieldsHarness: FC<{ product: Product | null; error?: string }> = ({ product, error }) => {
  const [form] = Form.useForm<ProductFormValues>();
  return (
    <ProductFormFields product={product} form={form} onFinish={() => undefined} {...(error ? { error } : {})} />
  );
};

const chartStub = (config: object): ReactElement => {
  const { xField, data } = config as { xField?: string; data?: unknown[] };
  return <div data-chart={String(xField ?? 'chart')} data-points={data?.length ?? 0} />;
};

const inventoryMarkup = render(
  'InventoryTable',
  <InventoryTable
    products={dataset.products.slice(0, 5)}
    rowActions={[
      { key: 'restock', label: 'Restock', icon: <span>R</span>, onClick: () => undefined },
    ]}
    onSelectedRowKeysChange={() => undefined}
  />,
);
check('inventory table renders product names', decodeEntities(inventoryMarkup).includes('Aurora') || inventoryMarkup.includes('ant-table'));
check('inventory table renders the header', inventoryMarkup.includes('SKU'));
check('inventory table renders a header row', inventoryMarkup.includes('<th'));
check('inventory table renders no horizontal page overflow', !inventoryMarkup.includes('width:100vw'));

const inventoryActions = render(
  'InventoryTable with actions',
  <InventoryTable
    products={[sampleProduct]}
    rowActions={[{ key: 'edit', label: 'Edit product', icon: <span>E</span>, onClick: () => undefined }]}
  />,
);
check(
  'inventory action triggers carry a per-row name',
  inventoryActions.includes('aria-label="Edit product '),
  inventoryActions.slice(0, 400),
);

const emptyInventory = render('InventoryTable empty', <InventoryTable products={[]} />);
check('empty inventory explains itself', emptyInventory.includes('No products yet'));

const toolbarMarkup = render(
  'StockFilterToolbar',
  <StockFilterToolbar
    filters={{ category: 'all', stockStatus: 'low_stock', searchQuery: 'aurora' }}
    onCategoryChange={() => undefined}
    onStockStatusChange={() => undefined}
    onSearchQueryChange={() => undefined}
    onReset={() => undefined}
    totalCount={30}
    filteredCount={4}
  />,
);
check('toolbar is a search landmark', toolbarMarkup.includes('role="search"'));
check('toolbar shows the filtered count', decodeEntities(toolbarMarkup).includes('4 of 30'));
check('toolbar reset is enabled while filtered', !toolbarMarkup.includes('disabled=""'));

const toolbarClean = render(
  'StockFilterToolbar unfiltered',
  <StockFilterToolbar
    filters={{ category: 'all', stockStatus: 'all', searchQuery: '' }}
    onCategoryChange={() => undefined}
    onStockStatusChange={() => undefined}
    onSearchQueryChange={() => undefined}
    onReset={() => undefined}
  />,
);
check('toolbar reset is disabled when nothing is filtered', toolbarClean.includes('disabled=""'));

const ordersMarkup = render(
  'OrdersTable',
  <OrdersTable
    orders={dataset.orders.slice(0, 4)}
    onOpenOrder={() => undefined}
    onTransition={() => undefined}
    onStatusFilterChange={() => undefined}
  />,
);
check('orders table renders order numbers', ordersMarkup.includes('ORD-'));
check('orders table shows the recognised total', decodeEntities(ordersMarkup).includes('recognised'));

const kpiMarkup = render('KPIOverviewGrid', <KPIOverviewGrid stats={kpiStats} />);
check('kpi grid is a labelled region', kpiMarkup.includes('aria-label="Key performance indicators"'));
check('kpi grid renders all six titles', ['Total Revenue', 'Revenue Growth', 'Net Profit', 'Profit Margin', 'Average Order Value', 'Stock Alerts'].every((title) => kpiMarkup.includes(title)));
check('kpi grid describes metrics for assistive tech', kpiMarkup.includes('visually-hidden'));

const kpiLoading = render('KPIOverviewGrid loading', <KPIOverviewGrid stats={kpiStats} loading />);
check('kpi grid reserves space while loading', kpiLoading.includes('aria-busy="true"'));

const seriesMarkup = render(
  'RevenueTimeSeriesChart',
  <RevenueTimeSeriesChart
    data={timeSeries}
    interval="day"
    chartRenderer={(config) => chartStub(config)}
  />,
);
check('time series renders the chart stub', seriesMarkup.includes('data-chart="date"'));
check('time series exposes an image role', seriesMarkup.includes('role="img"'));
check('time series describes its window', decodeEntities(seriesMarkup).includes('days'));

const seriesEmpty = render(
  'RevenueTimeSeriesChart empty',
  <RevenueTimeSeriesChart data={[]} interval="day" chartRenderer={(config) => chartStub(config)} />,
);
check('time series explains an empty window', seriesEmpty.includes('No sales in this window'));
check('time series hides zoom for tiny datasets', !seriesEmpty.includes('Zoom the visible time window'));

const seriesLoading = render(
  'RevenueTimeSeriesChart loading',
  <RevenueTimeSeriesChart data={timeSeries} interval="day" loading chartRenderer={(config) => chartStub(config)} />,
);
check('time series reserves height while loading', seriesLoading.includes('aria-busy="true"'));

const donutMarkup = render(
  'CategoryBreakdownChart',
  <CategoryBreakdownChart
    data={categoryPoints}
    chartRenderer={(config) => chartStub(config)}
    onCategorySelect={() => undefined}
  />,
);
check('donut exposes an image role', donutMarkup.includes('role="img"'));
check('donut legend is a list', donutMarkup.includes('<ul'));
check('donut legend drives filtering', donutMarkup.includes('aria-label="Revenue by category — select a category to filter"'));
check('donut renders the grouped tail', decodeEntities(donutMarkup).includes('Other'));
check('the aggregate row is not selectable', donutMarkup.includes('Grouped categories; not selectable'));

const donutSelected = render(
  'CategoryBreakdownChart selected',
  <CategoryBreakdownChart
    data={categoryPoints}
    selectedCategory="Category 00"
    onCategorySelect={() => undefined}
    chartRenderer={(config) => chartStub(config)}
  />,
);
check('the applied filter is announced', donutSelected.includes('aria-pressed="true"'));
check('the applied filter is described', decodeEntities(donutSelected).includes('Currently applied as a filter'));

const snapshotMarkup = render(
  'RecentOrdersSnapshot',
  <RecentOrdersSnapshot orders={dataset.orders} now={FIXTURE_NOW} onOpenOrder={() => undefined} onViewAll={() => undefined} />,
);
check('snapshot is a labelled region', snapshotMarkup.includes('aria-label="Recent orders"'));
check(
  'snapshot renders exactly six rows',
  (snapshotMarkup.match(/<li/g) ?? []).length === DEFAULT_RECENT_ORDER_COUNT,
  `${(snapshotMarkup.match(/<li/g) ?? []).length} rows`,
);

const snapshotEmpty = render('RecentOrdersSnapshot empty', <RecentOrdersSnapshot orders={[]} />);
check('empty snapshot explains itself', snapshotEmpty.includes('No recent orders'));

const rangeMarkup = render(
  'SalesDateRangePicker',
  <SalesDateRangePicker value={resolvePresetRange('30d', FIXTURE_NOW)} onChange={() => undefined} now={FIXTURE_NOW} />,
);
check('range picker labels its preset select', rangeMarkup.includes('aria-label="Reporting period preset"'));
check('range picker states the span in UTC', decodeEntities(rangeMarkup).includes('UTC'));
check('range picker shows a reset only when custom', !rangeMarkup.includes('Reset to 30 days'));

const rangeCustom = render(
  'SalesDateRangePicker custom',
  <SalesDateRangePicker
    value={{ startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-01-15T00:00:00.000Z' }}
    onChange={() => undefined}
    now={FIXTURE_NOW}
  />,
);
check('a custom range offers a reset', rangeCustom.includes('Reset to 30 days'));

/* Ant Design overlays mount through a portal and render nothing without a
   document, so the overlay content is asserted through the portal-free body
   components each shell wraps, plus the shell's own closed state. */

const bodyMarkup = render('OrderDetailBody', <OrderDetailBody order={sampleOrder} />);
check('order body renders the order number', bodyMarkup.includes(sampleOrder.orderNumber));
check('order body names its line items', bodyMarkup.includes('Line items'));
check('order body shows the fulfilment cost profile', bodyMarkup.includes('Cost of goods'));
check('order body shows the lifecycle', bodyMarkup.includes('Lifecycle'));
check('order body shows the payment method', bodyMarkup.includes('Payment'));
check('order body names the customer', bodyMarkup.includes(sampleOrder.customer.name));
check(
  'order body lists every line item SKU',
  sampleOrder.items.every((item) => bodyMarkup.includes(item.sku)),
  sampleOrder.items.map((item) => item.sku).join(','),
);
check('order body explains a lifecycle stage', bodyMarkup.includes('Order placed'));
check('order body states the placement time in UTC', decodeEntities(bodyMarkup).includes('UTC'));

const recognisedOrder = dataset.orders.find((order) => isRevenueRecognizedOrder(order.status));
if (recognisedOrder) {
  const recognised = render('OrderDetailBody recognised', <OrderDetailBody order={recognisedOrder} />);
  check(
    'a recognised order is not flagged as unrecognised',
    !recognised.includes('Revenue not recognised'),
  );
}
const unrecognisedOrder = dataset.orders.find((order) => !isRevenueRecognizedOrder(order.status));
if (unrecognisedOrder) {
  const unrecognised = render('OrderDetailBody unrecognised', <OrderDetailBody order={unrecognisedOrder} />);
  check(
    'an unrecognised order explains its exclusion from aggregates',
    unrecognised.includes('Revenue not recognised'),
  );
}

const barMarkup = render('OrderTransitionBar', <OrderTransitionBar order={sampleOrder} onTransition={() => undefined} />);
check('the transition bar announces its purpose', barMarkup.includes('Move this order to'));
for (const option of buildTransitionOptions(sampleOrder)) {
  check(`the transition bar offers ${option.status}`, decodeEntities(barMarkup).includes(option.label), option.label);
}
check(
  'a revenue-reversing transition announces the consequence',
  barMarkup.includes('returns stock and reverses revenue'),
);

const terminalOrder = dataset.orders.find((order) => buildTransitionOptions(order).length === 0);
if (terminalOrder) {
  const terminal = render('OrderTransitionBar terminal', <OrderTransitionBar order={terminalOrder} onTransition={() => undefined} />);
  check('a terminal order explains why it has no triggers', terminal.includes('final status'));
  check('a terminal order offers no status buttons', !terminal.includes('Move this order to'));
}

const pendingSample = dataset.orders.find((order) => order.status === 'pending');
if (pendingSample) {
  const pendingBar = render(
    'OrderTransitionBar pending',
    <OrderTransitionBar order={pendingSample} onTransition={() => undefined} />,
  );
  const triggerCount = buildTransitionOptions(pendingSample).length;
  check(
    'every trigger meets the 44px touch target',
    (pendingBar.match(/min-height:44px/g) ?? []).length >= triggerCount,
    `${(pendingBar.match(/min-height:44px/g) ?? []).length} of ${triggerCount}`,
  );
}

const closedDrawer = render(
  'OrderDetailDrawer closed',
  <OrderDetailDrawer order={sampleOrder} open={false} onClose={() => undefined} onTransition={() => undefined} />,
);
check('a closed drawer renders no panel', !closedDrawer.includes('Line items'));

const drawerShell = render(
  'OrderDetailDrawer open',
  <OrderDetailDrawer order={sampleOrder} open onClose={() => undefined} onTransition={() => undefined} />,
);
// The panel is portalled, so the shell itself must not duplicate the body.
check('the drawer shell does not duplicate the body', !drawerShell.includes('Cost of goods'));
check('the drawer shell does not duplicate the triggers', !drawerShell.includes('Move this order to'));

/* -- Stock adjustment form -------------------------------------------------- */

const adjustmentFormMarkup = render(
  'StockAdjustmentForm',
  <AdjustmentFormHarness
    product={sampleProduct}
    {...(sampleVariant ? { variantId: sampleVariant.id } : {})}
    currentQuantity={sampleVariant?.stockQuantity ?? 0}
  />,
);
check('stock form names the product', decodeEntities(adjustmentFormMarkup).includes(sampleProduct.name));
check('stock form offers a change type', adjustmentFormMarkup.includes('Inventory change type'));
check('stock form demands a reason', adjustmentFormMarkup.includes('Reason'));
check('stock form asks for a quantity', adjustmentFormMarkup.includes('Quantity of units to adjust'));
check('stock form shows the units on hand', decodeEntities(adjustmentFormMarkup).includes('units available'));
check('stock form explains the chosen direction', adjustmentFormMarkup.includes('Removes from stock') || adjustmentFormMarkup.includes('Adds to stock'));

const adjustmentNoVariant = render(
  'StockAdjustmentForm product-level',
  <AdjustmentFormHarness product={sampleProduct} currentQuantity={sampleProduct.totalStock} />,
);
check('product-level adjustment still offers variants', adjustmentNoVariant.includes('Variant to adjust'));

const adjustmentError = render(
  'StockAdjustmentForm with error',
  <AdjustmentFormHarness
    product={sampleProduct}
    currentQuantity={sampleProduct.totalStock}
    error="The transaction was rolled back: another session changed this balance."
  />,
);
check('a failed transaction is announced', adjustmentError.includes('role="alert"'));
check('the failure explains itself', decodeEntities(adjustmentError).includes('rolled back'));

const closedModal = render(
  'StockAdjustmentModal closed',
  <StockAdjustmentModal open={false} product={sampleProduct} onCancel={() => undefined} onSubmit={() => undefined} />,
);
check('a closed modal renders no dialog', !closedModal.includes('Adjust stock'));

/* -- Product form ----------------------------------------------------------- */

const createFormMarkup = render(
  'ProductFormFields create',
  <ProductFieldsHarness product={null} />,
);
check('product form asks for a name', createFormMarkup.includes('Product name'));
check('product form asks for a SKU', createFormMarkup.includes('Product SKU'));
check('product form asks for a category', createFormMarkup.includes('Product category'));
check('product form asks for a brand', createFormMarkup.includes('Product brand'));
check('product form asks for a description', createFormMarkup.includes('Product description'));
check('product form asks for a safety threshold', createFormMarkup.includes('Safety stock threshold in units'));
check('product form offers an empty variant row', createFormMarkup.includes('Variant 1'));
check('product form offers a second SKU field', createFormMarkup.includes('Variant 1 SKU'));
check('product form caps the variant count', decodeEntities(createFormMarkup).includes(`1/${MAX_VARIANTS_PER_PRODUCT}`));
check('product form seeds an empty variant', createFormMarkup.includes('placeholder="Variant name"'));

const editFormMarkup = render(
  'ProductFormFields edit',
  <ProductFieldsHarness product={sampleProduct} />,
);
check('product form prefills the SKU', editFormMarkup.includes(sampleProduct.sku));
check(
  'product form renders a row per existing variant',
  decodeEntities(editFormMarkup).includes(`Variant ${sampleProduct.variants.length}`),
);
check('product form keeps the first variant editable', editFormMarkup.includes(`aria-label="Variant 1 name"`));
check('product form removes a variant', editFormMarkup.includes('aria-label="Remove variant 1"'));

const formError = render(
  'ProductFormFields with error',
  <ProductFieldsHarness product={null} error="SKU is already in use." />,
);
check('a rejected save is announced', formError.includes('role="alert"'));

console.log(`\n[components] ${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n[components] ${failures.length} FAILURES:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
}
