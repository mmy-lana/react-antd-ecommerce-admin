/**
 * Dashboard screen (plan Task 5.2).
 *
 * Binds the four analytics surfaces to one set of live queries so the KPI row,
 * the revenue chart, the category donut and the recent-orders list can never
 * disagree with each other or with the tables behind them.
 *
 * Interaction wiring:
 *  - the donut legend doubles as a category filter, and the active category is
 *    shown in the filter chip with a way back to "all";
 *  - the stock-alert KPI jumps to Inventory with the matching status filter;
 *  - a recent order opens the same detail drawer the Sales view uses;
 *  - the restock watchlist opens a stock adjustment straight from the row.
 *
 * The view itself is exported separately from {@link DashboardView} so the
 * harness can mount it with fixture data and no database.
 */

import { Card, Col, Row, Tag, Typography } from 'antd';
import { useMemo, useState, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { SkeletonBoard } from '../../../shared/components/feedback/SkeletonBoard';
import { formatCurrency, formatCurrencyCompact } from '../../../shared/utils/currency';
import { formatUtc } from '../../../shared/utils/dateMath';
import { exportRowsToCsv, salesOrderCsvColumns } from '../../../shared/utils/exportCsv';
import {
  isRevenueRecognizedOrder,
  type CategoryFilter,
  type DateRangeFilter,
  type KPIStats,
  type Order,
  type Product,
  type SalesTimeSeriesPoint,
  type CategorySalesPoint,
  type UUID,
} from '../../../shared/types';
import { useRouter } from '../../../app/Router';
import { useDashboardMetrics, type TimeSeriesInterval } from '../hooks/useDashboardMetrics';
import {
  CategoryBreakdownChart,
  type CategoryBreakdownChartProps,
} from '../components/CategoryBreakdownChart';
import { KPIOverviewGrid } from '../components/KPIOverviewGrid';
import { RecentOrdersSnapshot } from '../components/RecentOrdersSnapshot';
import {
  RevenueTimeSeriesChart,
  type RevenueTimeSeriesChartProps,
} from '../components/RevenueTimeSeriesChart';
import { OrderDetailDrawer } from '../../sales/components/OrderDetailDrawer';
import { useOrderMutations, useOrders } from '../../sales/hooks/useOrders';
import { StockAdjustmentModal, type AdjustmentInput } from '../../inventory/components/StockAdjustmentModal';
import { useProductMutations } from '../../inventory/hooks/useProductMutations';
import { useInventory } from '../../inventory/hooks/useInventory';
import { ALL_FILTER_VALUE } from '../../inventory/components/StockFilterToolbar';
import {
  DATE_RANGE_PRESETS,
  resolvePresetRange,
  type DateRangePresetKey,
} from '../../sales/components/SalesDateRangePicker';

export const DEFAULT_DASHBOARD_RANGE_DAYS = 30;

/**
 * Units a product is below its safety line.
 *
 * Zero or negative when healthy. This is the watchlist's own criterion rather
 * than `Product.status`, because the status is derived: a variant-level change
 * can leave a product flagged `in_stock` while its own stock sits under the
 * line, and the watchlist must not hide that.
 */
export const stockDeficit = (product: Pick<Product, 'totalStock' | 'safetyStockThreshold'>): number =>
  Math.max(0, product.safetyStockThreshold - product.totalStock);

/** A product row in the restock watchlist. */
export interface RestockRow {
  product: Product;
  /** Units below the safety line, never negative. */
  deficit: number;
  /** What it would cost to bring the line back to the safety threshold. */
  estimatedCost: number;
}

export const buildRestockRows = (products: readonly Product[]): RestockRow[] =>
  products
    .filter((product) => !product.isArchived && stockDeficit(product) > 0)
    .map((product) => {
      const deficit = Math.max(0, product.safetyStockThreshold - product.totalStock);
      return {
        product,
        deficit,
        estimatedCost: Math.round(deficit * product.baseCost * 100) / 100,
      };
    })
    .sort((left, right) => right.deficit - left.deficit || left.product.name.localeCompare(right.product.name));

export interface DashboardViewBodyProps {
  range: DateRangeFilter;
  interval: TimeSeriesInterval;
  stats: KPIStats;
  series: readonly SalesTimeSeriesPoint[];
  categorySeries: readonly CategorySalesPoint[];
  products: readonly Product[];
  recentOrders: readonly Order[];
  hasPreviousPeriod: boolean;
  loading: boolean;
  category: CategoryFilter;
  onCategoryChange: (category: CategoryFilter) => void;
  onIntervalChange: (interval: TimeSeriesInterval) => void;
  onNavigateToInventory: (stockStatus?: string) => void;
  onNavigateToSales: () => void;
  onRangeChange: (presetKey: DateRangePresetKey) => void;
  rangePresetKey: DateRangePresetKey;
  /** Injected in the harness, which has no IndexedDB. */
  onAdjustStock?: (input: AdjustmentInput) => Promise<void>;
  mutationsPending?: boolean;
  error?: string | null;
  /** Injected in the harness, which has no canvas to draw into. */
  chartRenderer?: {
    area: RevenueTimeSeriesChartProps['chartRenderer'];
    pie: CategoryBreakdownChartProps['chartRenderer'];
  };
}

const SectionHeading: FC<{ title: string; hint: string; extra?: ReactNode }> = ({ title, hint, extra }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: layoutTokens.gridGutter,
      flexWrap: 'wrap',
      marginBottom: layoutTokens.gridGutter,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <Typography.Text strong style={{ color: colorTokens.textPrimary, display: 'block' }}>
        {title}
      </Typography.Text>
      <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
        {hint}
      </Typography.Text>
    </div>
    {extra}
  </div>
);

/**
 * The dashboard's content, with no database or router of its own.
 */
export const DashboardViewBody: FC<DashboardViewBodyProps> = ({
  range,
  interval,
  stats,
  series,
  categorySeries,
  products,
  recentOrders,
  hasPreviousPeriod,
  loading,
  category,
  onCategoryChange,
  onIntervalChange,
  onNavigateToInventory,
  onNavigateToSales,
  onRangeChange,
  rangePresetKey,
  onAdjustStock,
  mutationsPending = false,
  error = null,
  chartRenderer,
}) => {
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ product: Product; variantId?: UUID } | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const restockRows = useMemo(() => buildRestockRows(products).slice(0, 8), [products]);
  const restockTotal = useMemo(
    () => Math.round(restockRows.reduce((total, row) => total + row.estimatedCost, 0) * 100) / 100,
    [restockRows],
  );

  const rangeLabel = `${formatUtc(range.startDate, 'MMM D')} – ${formatUtc(range.endDate, 'MMM D, YYYY')}`;

  const handleAdjust = async (input: AdjustmentInput): Promise<void> => {
    setAdjustError(null);
    try {
      await onAdjustStock?.(input);
    } catch (cause) {
      setAdjustError(cause instanceof Error ? cause.message : 'The adjustment could not be saved.');
    }
  };

  const exportOrders = (): void => {
    exportRowsToCsv({
      filename: 'recent-orders',
      columns: salesOrderCsvColumns,
      rows: [...recentOrders],
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: layoutTokens.contentPadding,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
          {rangeLabel}
        </Typography.Text>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DATE_RANGE_PRESETS.filter((preset) => preset.key !== 'custom').map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onRangeChange(preset.key)}
              aria-pressed={rangePresetKey === preset.key}
              style={{
                minHeight: layoutTokens.touchTargetMinSize,
                padding: '0 12px',
                borderRadius: 8,
                border: `1px solid ${rangePresetKey === preset.key ? colorTokens.primary : colorTokens.borderColor}`,
                background: rangePresetKey === preset.key ? colorTokens.primarySurface : colorTokens.cardBackground,
                color: rangePresetKey === preset.key ? colorTokens.primary : colorTokens.textSecondary,
                cursor: 'pointer',
                fontFamily: fontTokens.fontFamily,
                fontSize: fontTokens.fontSizeSmall,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error === null ? null : (
        <Card
          role="alert"
          size="small"
          style={{ borderColor: colorTokens.error, background: colorTokens.errorSurface }}
        >
          <Typography.Text style={{ color: colorTokens.error }}>{error}</Typography.Text>
        </Card>
      )}

      {loading ? (
        <SkeletonBoard variant="dashboard" />
      ) : (
        <>
          <KPIOverviewGrid
            stats={stats}
            hasPreviousPeriod={hasPreviousPeriod}
            comparisonLabel={`vs ${rangeLabel}`}
            onStockAlertClick={(kind) => onNavigateToInventory(kind === 'out_of_stock' ? 'out_of_stock' : 'low_stock')}
          />

          <Row gutter={[layoutTokens.gridGutter, layoutTokens.gridGutter]}>
            <Col xs={24} xl={16} style={{ minWidth: 0 }}>
              <Card
                title="Revenue and profit over time"
                styles={{ body: { paddingTop: 12 } }}
                extra={
                  <div role="group" aria-label="Aggregation interval" style={{ display: 'flex', gap: 6 }}>
                    {(['day', 'week', 'month'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={interval === option}
                        onClick={() => onIntervalChange(option)}
                        style={{
                          minHeight: layoutTokens.touchTargetMinSize,
                          padding: '0 10px',
                          borderRadius: 8,
                          border: `1px solid ${interval === option ? colorTokens.primary : colorTokens.borderColor}`,
                          background:
                            interval === option ? colorTokens.primarySurface : colorTokens.cardBackground,
                          color: interval === option ? colorTokens.primary : colorTokens.textSecondary,
                          cursor: 'pointer',
                          fontFamily: fontTokens.fontFamily,
                          fontSize: fontTokens.fontSizeSmall,
                        }}
                      >
                        {option === 'day' ? 'Daily' : option === 'week' ? 'Weekly' : 'Monthly'}
                      </button>
                    ))}
                  </div>
                }
              >
                <SectionHeading
                  title="Recognised revenue only"
                  hint="Cancelled and refunded orders are excluded from every point on this line."
                />
                <RevenueTimeSeriesChart
                  data={series}
                  interval={interval === 'week' ? 'day' : interval}
                  loading={loading}
                  {...(chartRenderer === undefined ? {} : { chartRenderer: chartRenderer.area })}
                  emptyState={
                    <EmptyStateView
                      variant="empty"
                      title="No sales in this window"
                      description="Widen the date range, or place an order to see the trend build up."
                    />
                  }
                />
              </Card>
            </Col>

            <Col xs={24} xl={8} style={{ minWidth: 0 }}>
              <Card title="Revenue by category">
                <SectionHeading
                  title="Where the money came from"
                  hint="Select a category to filter the whole dashboard."
                  extra={
                    category === ALL_FILTER_VALUE ? undefined : (
                      <Tag
                        closable
                        onClose={() => onCategoryChange(ALL_FILTER_VALUE)}
                        style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                      >
                        {category}
                      </Tag>
                    )
                  }
                />
                <CategoryBreakdownChart
                  data={categorySeries}
                  selectedCategory={category === ALL_FILTER_VALUE ? undefined : category}
                  {...(chartRenderer === undefined ? {} : { chartRenderer: chartRenderer.pie })}
                  onCategorySelect={(next) => onCategoryChange(next ?? ALL_FILTER_VALUE)}
                  emptyState={
                    <EmptyStateView
                      variant="empty"
                      title="No category revenue yet"
                      description="Revenue appears here once orders are recognised in this window."
                    />
                  }
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[layoutTokens.gridGutter, layoutTokens.gridGutter]}>
            <Col xs={24} xl={14} style={{ minWidth: 0 }}>
              <Card
                title="Recent orders"
                extra={
                  <button
                    type="button"
                    onClick={onNavigateToSales}
                    style={{
                      minHeight: layoutTokens.touchTargetMinSize,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: `1px solid ${colorTokens.borderColor}`,
                      background: colorTokens.cardBackground,
                      color: colorTokens.primary,
                      cursor: 'pointer',
                      fontFamily: fontTokens.fontFamily,
                      fontSize: fontTokens.fontSizeSmall,
                    }}
                  >
                    View all sales
                  </button>
                }
              >
                <RecentOrdersSnapshot
                  orders={recentOrders}
                  onOpenOrder={setOpenOrder}
                  onViewAll={onNavigateToSales}
                  onExport={exportOrders}
                  emptyState={
                    <EmptyStateView
                      variant="search"
                      title="Nothing ordered in this window"
                      description="Try a wider date range to see earlier activity."
                    />
                  }
                />
              </Card>
            </Col>

            <Col xs={24} xl={10} style={{ minWidth: 0 }}>
              <Card
                title="Restock watchlist"
                extra={
                  <button
                    type="button"
                    onClick={() => onNavigateToInventory('low_stock')}
                    style={{
                      minHeight: layoutTokens.touchTargetMinSize,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: `1px solid ${colorTokens.borderColor}`,
                      background: colorTokens.cardBackground,
                      color: colorTokens.primary,
                      cursor: 'pointer',
                      fontFamily: fontTokens.fontFamily,
                      fontSize: fontTokens.fontSizeSmall,
                    }}
                  >
                    Open inventory
                  </button>
                }
              >
                <SectionHeading
                  title={`${restockRows.length} item${restockRows.length === 1 ? '' : 's'} below the safety line`}
                  hint={`Bringing every line back to its threshold costs about ${formatCurrency(restockTotal)}.`}
                />
                {restockRows.length === 0 ? (
                  <EmptyStateView
                    variant="empty"
                    title="Stock is healthy"
                    description="No product is at or below its safety threshold right now."
                  />
                ) : (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {restockRows.map(({ product, deficit, estimatedCost }) => (
                      <li
                        key={product.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          paddingBottom: 8,
                          borderBottom: `1px solid ${colorTokens.borderColor}`,
                        }}
                      >
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <Typography.Text
                            style={{ color: colorTokens.textPrimary, display: 'block', wordBreak: 'break-word' }}
                          >
                            {product.name}
                          </Typography.Text>
                          <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
                            {product.sku} · {deficit} short · {formatCurrencyCompact(estimatedCost)} at cost
                          </Typography.Text>
                        </span>
                        <button
                          type="button"
                          onClick={() => setAdjustTarget({ product })}
                          disabled={mutationsPending}
                          style={{
                            minHeight: layoutTokens.touchTargetMinSize,
                            minWidth: layoutTokens.touchTargetMinSize,
                            padding: '0 12px',
                            borderRadius: 8,
                            border: `1px solid ${colorTokens.primary}`,
                            background: colorTokens.primarySurface,
                            color: colorTokens.primary,
                            cursor: 'pointer',
                            fontFamily: fontTokens.fontFamily,
                            fontSize: fontTokens.fontSizeSmall,
                          }}
                        >
                          Restock
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      <OrderDetailDrawer
        order={openOrder}
        open={openOrder !== null}
        onClose={() => setOpenOrder(null)}
      />

      <StockAdjustmentModal
        open={adjustTarget !== null}
        product={adjustTarget?.product ?? null}
        {...(adjustTarget?.variantId === undefined ? {} : { variantId: adjustTarget.variantId })}
        onCancel={() => setAdjustTarget(null)}
        onSubmit={handleAdjust}
        {...(adjustError === null ? {} : { error: adjustError })}
      />
    </div>
  );
};

/**
 * The connected dashboard: reads the live queries and owns the filters.
 */
export const DashboardView: FC = () => {
  const [presetKey, setPresetKey] = useState<DateRangePresetKey>('30d');
  const [intervalOverride, setIntervalOverride] = useState<TimeSeriesInterval | undefined>(undefined);
  const [category, setCategory] = useState<CategoryFilter>(ALL_FILTER_VALUE);

  const range = useMemo(
    () => resolvePresetRange(presetKey, new Date()),
    [presetKey],
  );

  const metrics = useDashboardMetrics({ range, category, ...(intervalOverride ? { interval: intervalOverride } : {}) });
  const orders = useOrders();
  // The watchlist is a property of the catalogue, not of the sales window, so it
  // reads products directly and ignores the dashboard's date range.
  const inventory = useInventory();
  const productMutations = useProductMutations();
  const orderMutations = useOrderMutations();

  const recentOrders = useMemo(
    () => orders.orders.filter((order) => isRevenueRecognizedOrder(order.status) || order.status === 'pending'),
    [orders.orders],
  );

  const { navigate } = useRouter();

  // A deep link keeps the filter in the URL, so the destination view can read
  // it from the router instead of the two views sharing mutable state.
  const navigateToInventory = (stockStatus?: string): void => {
    navigate('inventory', stockStatus === undefined ? undefined : { status: stockStatus });
  };

  const handleAdjust = async (input: AdjustmentInput): Promise<void> => {
    await productMutations.mutateProductStock({
      productId: input.productId,
      ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
      changeType: input.changeType,
      quantity: input.quantity,
      reason: input.reason,
    });
  };

  return (
    <DashboardViewBody
      range={range}
      interval={metrics.interval}
      stats={metrics.stats}
      series={metrics.series}
      categorySeries={metrics.categorySeries}
      products={inventory.products}
      recentOrders={recentOrders.slice(0, 6)}
      hasPreviousPeriod={metrics.hasPreviousPeriod}
      loading={metrics.loading || inventory.loading}
      category={category}
      onCategoryChange={setCategory}
      onIntervalChange={setIntervalOverride}
      onNavigateToInventory={navigateToInventory}
      onNavigateToSales={() => navigate('sales')}
      onRangeChange={setPresetKey}
      rangePresetKey={presetKey}
      onAdjustStock={handleAdjust}
      mutationsPending={productMutations.pending || orderMutations.pending}
      error={metrics.error ?? productMutations.error}
    />
  );
};

export default DashboardView;
