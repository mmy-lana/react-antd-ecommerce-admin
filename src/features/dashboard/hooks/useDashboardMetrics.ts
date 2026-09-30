/**
 * Dashboard aggregates (plan Task 4.4).
 *
 * Every figure on the dashboard is derived from the same two live queries, so
 * the KPI row, the revenue chart, the category donut and the recent-orders list
 * can never disagree with each other or with the tables behind them.
 *
 * Date boundaries are parsed through `dayjs` **in UTC**. Stored timestamps are
 * ISO 8601 UTC strings; parsing them in the browser's local zone would shift
 * orders across day boundaries near midnight and silently change the numbers.
 * The bucketing, the KPI aggregation and the series construction are exported as
 * pure functions so they can be asserted without a database.
 */

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import utc from 'dayjs/plugin/utc';

import { db } from '../../../shared/db/dexieDb';
import {
  isRevenueRecognizedOrder,
  type CategorySalesPoint,
  type DateRangeFilter,
  type KPIStats,
  type Order,
  type Product,
  type SalesTimeSeriesPoint,
  type UUID,
} from '../../../shared/types';

dayjs.extend(utc);
dayjs.extend(isoWeek);

/* -------------------------------------------------------------------------- */
/* Date handling                                                               */
/* -------------------------------------------------------------------------- */

export type TimeSeriesInterval = 'day' | 'week' | 'month';

/** `'YYYY-MM-DD'` in UTC. */
export const toUtcDayKey = (iso: string): string => dayjs.utc(iso).format('YYYY-MM-DD');

/** `'YYYY-MM'` in UTC. */
export const toUtcMonthKey = (iso: string): string => dayjs.utc(iso).format('YYYY-MM');

/** `'YYYY-Www'` in UTC, ISO week numbering, so weeks sort lexicographically. */
export const toUtcWeekKey = (iso: string): string => {
  const date = dayjs.utc(iso);
  const year = date.isoWeekYear();
  const week = String(date.isoWeek()).padStart(2, '0');
  return `${year}-W${week}`;
};

export const formatBucketKey = (key: string, interval: TimeSeriesInterval): string => {
  if (interval === 'month') return dayjs.utc(`${key}-01`).format('MMM YYYY');
  if (interval === 'week') {
    // `YYYY-Www` -> "Wk" label; the trailing digits are enough to identify it.
    return `W${key.split('-W')[1] ?? key}`;
  }
  return dayjs.utc(key).format('MMM D');
};

export const bucketKeyFor = (iso: string, interval: TimeSeriesInterval): string => {
  if (interval === 'month') return toUtcMonthKey(iso);
  if (interval === 'week') return toUtcWeekKey(iso);
  return toUtcDayKey(iso);
};

/** The interval a range is best summarised at. */
export const resolveInterval = (range: DateRangeFilter): TimeSeriesInterval => {
  const days = dayjs.utc(range.endDate).diff(dayjs.utc(range.startDate), 'day');
  if (days > 120) return 'month';
  if (days > 45) return 'week';
  return 'day';
};

/** Every bucket between two dates, so a quiet day still renders as a zero. */
export const buildBucketKeys = (range: DateRangeFilter, interval: TimeSeriesInterval): string[] => {
  const start = dayjs.utc(range.startDate).startOf('day');
  const end = dayjs.utc(range.endDate).startOf('day');
  const keys: string[] = [];
  const stepUnit = interval === 'month' ? 'month' : 'day';

  // A week bucket advances by 7 days from the range start rather than by ISO
  // week, so the first and last buckets are never empty.
  const step = interval === 'week' ? 7 : 1;
  let cursor = start;
  let guard = 0;
  while ((cursor.isBefore(end) || cursor.isSame(end, 'day')) && guard < 2000) {
    keys.push(
      interval === 'month'
        ? cursor.format('YYYY-MM')
        : interval === 'week'
          ? toUtcWeekKey(cursor.toISOString())
          : cursor.format('YYYY-MM-DD'),
    );
    cursor =
      interval === 'week' ? cursor.add(step, 'day') : cursor.add(1, stepUnit);
    guard += 1;
  }
  return keys;
};

export const isWithinFilter = (iso: string, range: DateRangeFilter): boolean =>
  iso >= range.startDate && iso <= range.endDate;

/* -------------------------------------------------------------------------- */
/* KPI aggregation                                                             */
/* -------------------------------------------------------------------------- */

export interface PeriodTotals {
  orderCount: number;
  revenue: number;
  grossProfit: number;
  unitsSold: number;
  averageOrderValue: number;
  grossMarginPct: number;
}

/** Tally one period. Cancelled and refunded orders contribute nothing. */
export const tallyOrders = (orders: readonly Order[]): PeriodTotals => {
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
  let revenue = 0;
  let grossProfit = 0;
  let unitsSold = 0;
  let orderCount = 0;

  for (const order of orders) {
    if (!isRevenueRecognizedOrder(order.status)) continue;
    orderCount += 1;
    revenue += order.totalAmount;
    grossProfit += order.netProfit;
    unitsSold += order.items.reduce((total, item) => total + Math.max(0, item.quantity), 0);
  }

  return {
    orderCount,
    revenue: round2(revenue),
    grossProfit: round2(grossProfit),
    unitsSold,
    averageOrderValue: orderCount === 0 ? 0 : round2(revenue / orderCount),
    grossMarginPct: revenue === 0 ? 0 : round2((grossProfit / revenue) * 100),
  };
};

/** The immediately preceding window of the same length, for growth figures. */
export const buildPreviousRange = (range: DateRangeFilter): DateRangeFilter => {
  const start = dayjs.utc(range.startDate);
  const end = dayjs.utc(range.endDate);
  const span = end.diff(start, 'millisecond');
  // The window is shifted back by its own length *plus* the 1ms that separates
  // the two ranges, so the previous period covers exactly as much time and the
  // two never overlap.
  return {
    startDate: start.subtract(span + 1, 'millisecond').toISOString(),
    endDate: start.subtract(1, 'millisecond').toISOString(),
  };
};

/**
 * Percentage change against the previous window.
 *
 * With no baseline the change is arithmetically undefined, so this reports `0`
 * and the caller decides whether to show it: `hasPreviousPeriod` is false until
 * the dataset actually reaches back a full window, and the KPI grid renders a
 * dash instead of a fabricated trend.
 */
export const growthPercentage = (current: number, previous: number): number => {
  if (previous === 0) return 0;
  const value = ((current - previous) / Math.abs(previous)) * 100;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const buildKpiStats = (
  current: PeriodTotals,
  previous: PeriodTotals,
  lowStockCount: number,
  outOfStockCount: number,
): KPIStats => ({
  totalRevenue: current.revenue,
  revenueGrowthPct: growthPercentage(current.revenue, previous.revenue),
  grossProfit: current.grossProfit,
  profitMarginPct: current.grossMarginPct,
  totalOrders: current.orderCount,
  ordersGrowthPct: growthPercentage(current.orderCount, previous.orderCount),
  averageOrderValue: current.averageOrderValue,
  lowStockItemsCount: lowStockCount,
  outOfStockItemsCount: outOfStockCount,
});

/* -------------------------------------------------------------------------- */
/* Series construction                                                         */
/* -------------------------------------------------------------------------- */

export const buildSalesSeries = (
  orders: readonly Order[],
  range: DateRangeFilter,
  interval: TimeSeriesInterval,
): SalesTimeSeriesPoint[] => {
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
  const buckets = new Map<string, SalesTimeSeriesPoint>();

  for (const key of buildBucketKeys(range, interval)) {
    buckets.set(key, { date: key, revenue: 0, ordersCount: 0, profit: 0 });
  }

  for (const order of orders) {
    if (!isWithinFilter(order.createdAt, range)) continue;
    if (!isRevenueRecognizedOrder(order.status)) continue;
    const key = bucketKeyFor(order.createdAt, interval);
    const bucket = buckets.get(key);
    // An order can fall in a bucket the key list does not contain when the
    // range boundary is mid-period; it is added rather than dropped.
    if (bucket === undefined) {
      buckets.set(key, { date: key, revenue: order.totalAmount, ordersCount: 1, profit: order.netProfit });
      continue;
    }
    bucket.revenue += order.totalAmount;
    bucket.ordersCount += 1;
    bucket.profit += order.netProfit;
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => ({
      date: point.date,
      revenue: round2(point.revenue),
      ordersCount: point.ordersCount,
      profit: round2(point.profit),
    }));
};

export const OTHER_CATEGORY_LABEL = 'Other';

export const buildCategorySeries = (
  orders: readonly Order[],
  products: readonly Product[],
  range: DateRangeFilter,
): CategorySalesPoint[] => {
  const categoryByProduct = new Map<UUID, string>();
  for (const product of products) categoryByProduct.set(product.id, product.category);

  const revenueByCategory = new Map<string, { revenue: number; units: number }>();

  for (const order of orders) {
    if (!isWithinFilter(order.createdAt, range)) continue;
    if (!isRevenueRecognizedOrder(order.status)) continue;
    for (const item of order.items) {
      const category = categoryByProduct.get(item.productId) ?? 'Uncategorised';
      const current = revenueByCategory.get(category) ?? { revenue: 0, units: 0 };
      current.revenue += item.subtotal;
      current.units += Math.max(0, item.quantity);
      revenueByCategory.set(category, current);
    }
  }

  const totalRevenue = [...revenueByCategory.values()].reduce((total, entry) => total + entry.revenue, 0);
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

  return [...revenueByCategory.entries()]
    .map(([category, entry]) => ({
      category,
      revenue: round2(entry.revenue),
      unitsSold: entry.units,
      percentage: totalRevenue === 0 ? 0 : round2((entry.revenue / totalRevenue) * 100),
    }))
    .sort((left, right) => right.revenue - left.revenue || left.category.localeCompare(right.category));
};

export const buildSalesVolumeByCategory = (points: readonly CategorySalesPoint[]): number =>
  points.reduce((total, point) => total + point.unitsSold, 0);

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseDashboardMetricsOptions {
  range: DateRangeFilter;
  /** Override the automatic day/week/month choice. */
  interval?: TimeSeriesInterval;
  category?: string;
  stockStatus?: string;
  searchQuery?: string;
}

export interface DashboardMetrics {
  stats: KPIStats;
  series: SalesTimeSeriesPoint[];
  categorySeries: CategorySalesPoint[];
  previousRange: DateRangeFilter;
  interval: TimeSeriesInterval;
  hasPreviousPeriod: boolean;
  loading: boolean;
  error: string | null;
}

const matchesDashboardSearch = (product: Product, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return true;
  const haystack = [product.name, product.sku, product.brand, product.category]
    .join(' ')
    .toLowerCase();
  return trimmed.split(/\s+/).every((term) => haystack.includes(term));
};

export const useDashboardMetrics = (options: UseDashboardMetricsOptions): DashboardMetrics => {
  const { range, category, stockStatus, searchQuery = '' } = options;
  const interval = options.interval ?? resolveInterval(range);
  const previousRange = useMemo(() => buildPreviousRange(range), [range]);

  const liveOrders = useLiveQuery<Order[]>(() => db.orders.toArray(), []);
  const liveProducts = useLiveQuery<Product[]>(() => db.products.toArray(), []);

  const loadError = useLiveQuery<string | null>(
    async () => {
      try {
        await db.orders.count();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'The local database could not be read.';
      }
    },
    [],
  );

  const loading = liveOrders === undefined || liveProducts === undefined;
  const orders = useMemo(() => liveOrders ?? [], [liveOrders]);
  const products = useMemo(() => liveProducts ?? [], [liveProducts]);

  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        if (product.isArchived || product.deletedAt !== undefined) return false;
        if (category !== undefined && category !== 'all' && product.category !== category) return false;
        if (stockStatus !== undefined && stockStatus !== 'all' && product.status !== stockStatus) return false;
        return matchesDashboardSearch(product, searchQuery);
      }),
    [products, category, stockStatus, searchQuery],
  );

  const visibleProductIds = useMemo(() => new Set(visibleProducts.map((product) => product.id)), [visibleProducts]);

  const scopedOrders = useMemo(
    () => orders.filter((order) => order.items.every((item) => visibleProductIds.has(item.productId))),
    [orders, visibleProductIds],
  );

  const series = useMemo(
    () => buildSalesSeries(scopedOrders, range, interval),
    [scopedOrders, range, interval],
  );

  const categorySeries = useMemo(
    () => buildCategorySeries(scopedOrders, visibleProducts, range),
    [scopedOrders, visibleProducts, range],
  );

  const stats = useMemo(() => {
    const current = tallyOrders(scopedOrders.filter((order) => isWithinFilter(order.createdAt, range)));
    const previous = tallyOrders(scopedOrders.filter((order) => isWithinFilter(order.createdAt, previousRange)));
    const lowStockCount = visibleProducts.filter((product) => product.status === 'low_stock').length;
    const outOfStockCount = visibleProducts.filter((product) => product.status === 'out_of_stock').length;
    return buildKpiStats(current, previous, lowStockCount, outOfStockCount);
  }, [scopedOrders, range, previousRange, visibleProducts]);

  // There is nothing to compare against before the dataset reaches back one
  // full window, so the UI hides growth rather than inventing it.
  const hasPreviousPeriod = useMemo(
    () => orders.some((order) => isWithinFilter(order.createdAt, previousRange)),
    [orders, previousRange],
  );

  return {
    stats,
    series,
    categorySeries,
    previousRange,
    interval,
    hasPreviousPeriod,
    loading,
    error: loadError ?? null,
  };
};
