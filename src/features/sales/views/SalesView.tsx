/**
 * Sales screen (plan Task 5.4).
 *
 * Three surfaces over one order set: the volume trackers, the searchable orders
 * table and the detail drawer. They share a single set of filters (date range,
 * status, search) so a tracker always describes exactly the rows below it —
 * filtering to `shipped` makes the trackers count shipped orders, not all of
 * them.
 *
 * The layout is exported separately as {@link SalesViewBody} so the harness can
 * assert it: `OrderDetailDrawer` mounts through a portal and renders nothing
 * under `renderToStaticMarkup`.
 */

import { App as AntdApp, Button, Card, Col, Row, Typography } from 'antd';
import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { SkeletonBoard } from '../../../shared/components/feedback/SkeletonBoard';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber, formatPercent } from '../../../shared/utils/currency';
import { exportRowsToCsv, salesOrderCsvColumns } from '../../../shared/utils/exportCsv';
import { useRouter } from '../../../app/Router';
import type { DateRangeFilter, Order, OrderStatus, OrderStatusFilter } from '../../../shared/types';
import {
  ALL_STATUS_FILTER_VALUE,
  useOrderMutations,
  useOrders,
  type OrderFilters,
  type SalesAggregates,
} from '../hooks/useOrders';
import { ORDERS_STATUS_FILTER_OPTIONS } from '../components/OrdersTable';
import { OrderDetailDrawer } from '../components/OrderDetailDrawer';
import { OrdersTable } from '../components/OrdersTable';
import { SalesDateRangePicker, resolvePresetRange } from '../components/SalesDateRangePicker';
import { useProductMutations } from '../../inventory/hooks/useProductMutations';

/**
 * Confirmation copy for a revenue-reversing status change.
 *
 * A refund and a cancellation look identical to the status enum but are not the
 * same event: a refund means the money has already left and a ledger entry is
 * owed, while a cancellation abandons a fulfilment — only reachable from
 * `pending` or `processing`, before dispatch. Telling a merchant "money is
 * returned to you" for a pre-dispatch cancellation would be wrong, and telling
 * someone cancelling a shipped order that nothing happens would be worse. The
 * two branches previously carried byte-identical copy, so the choice on screen
 * was cosmetic.
 */
export const describeReversal = (nextStatus: OrderStatus, order: Order): ReactNode => {
  const units = order.items.reduce((total, item) => total + Math.max(0, item.quantity), 0);

  if (nextStatus === 'refunded') {
    return (
      <>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          {`${formatCurrency(order.totalAmount)} will be refunded to ${
            order.customer.name
          }, and ${formatNumber(units)} returned ${units === 1 ? 'unit goes' : 'units go'} back into stock.`}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Refunds are only available once an order has shipped. The order stops counting
          toward revenue, profit and average order value.
        </Typography.Paragraph>
      </>
    );
  }

  return (
    <>
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {`${formatNumber(units)} returned ${units === 1 ? 'unit goes' : 'units go'} back into stock and the order leaves the fulfilment queue.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {order.status === 'pending'
          ? 'Nothing has shipped and no capture has settled, so no refund is issued. The order stops counting toward revenue.'
          : 'This order is already picked and packed, so the items must be put back on the shelf rather than picked up where they left off. The order stops counting toward revenue.'}
      </Typography.Paragraph>
    </>
  );
};

/** Statuses offered in the tracker row, in fulfilment order. */
export const TRACKED_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
];

export interface VolumeTracker {
  status: OrderStatus;
  label: string;
  count: number;
  /** Share of all orders in range; 0 when there are no orders at all. */
  sharePct: number;
}

/**
 * Volume trackers for the pipeline statuses.
 *
 * `cancelled` and `refunded` are excluded on purpose: they are outcomes to
 * investigate, not stages of the pipeline, and the table's status filter
 * already surfaces them.
 */
export const buildVolumeTrackers = (aggregates: SalesAggregates): VolumeTracker[] =>
  TRACKED_ORDER_STATUSES.map((status) => {
    const count =
      status === 'pending'
        ? aggregates.pendingCount
        : status === 'processing'
          ? aggregates.processingCount
          : status === 'shipped'
            ? aggregates.shippedCount
            : aggregates.deliveredCount;

    return {
      status,
      label: STATUS_TRACKER_LABEL[status],
      count,
      sharePct: aggregates.orderCount === 0 ? 0 : (count / aggregates.orderCount) * 100,
    };
  });

export const STATUS_TRACKER_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

/**
 * Resolves a `?status=` query value to a real status filter.
 *
 * A hand-edited URL must not put the toolbar into a state its own select cannot
 * represent, so anything unrecognised is ignored.
 */
export const toOrderStatusFilter = (raw: string | undefined): OrderStatusFilter | undefined => {
  if (raw === undefined || raw === ALL_STATUS_FILTER_VALUE) return undefined;
  return ORDERS_STATUS_FILTER_OPTIONS.some((option) => option.value === raw)
    ? (raw as OrderStatusFilter)
    : undefined;
};

export interface SalesViewBodyProps {
  orders: readonly Order[];
  aggregates: SalesAggregates;
  loading: boolean;
  totalCount: number;
  range: DateRangeFilter;
  onRangeChange: (range: DateRangeFilter) => void;
  filters: Pick<OrderFilters, 'status' | 'searchQuery'>;
  onStatusChange: (status: OrderFilters['status']) => void;
  onSearchQueryChange: (query: string) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
  onOpenOrder: (order: Order) => void;
  onTransition: (order: Order, nextStatus: OrderStatus) => void;
  onExport: () => void;
  mutationsPending: boolean;
  error: string | null;
  headerControls?: ReactNode;
}

export const SalesViewBody: FC<SalesViewBodyProps> = ({
  orders,
  aggregates,
  loading,
  totalCount,
  range,
  onRangeChange,
  filters,
  onStatusChange,
  onSearchQueryChange,
  onResetFilters,
  hasActiveFilters,
  onOpenOrder,
  onTransition,
  onExport,
  mutationsPending,
  error,
  headerControls,
}) => {
  const compact = useIsCompact();
  const trackers = useMemo(() => buildVolumeTrackers(aggregates), [aggregates]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.contentPadding, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: layoutTokens.gridGutter,
          flexWrap: 'wrap',
        }}
      >
        <SalesDateRangePicker
          value={range}
          onChange={onRangeChange}
          {...(headerControls === undefined ? {} : { extra: headerControls })}
        />
      </div>

      {error === null ? null : (
        <Card role="alert" size="small" style={{ borderColor: colorTokens.error, background: colorTokens.errorSurface }}>
          <Typography.Text style={{ color: colorTokens.error }}>{error}</Typography.Text>
        </Card>
      )}

      {loading ? (
        <SkeletonBoard variant="kpi" />
      ) : (
        <Row gutter={[layoutTokens.gridGutter, layoutTokens.gridGutter]}>
          <Col xs={12} md={6} style={{ minWidth: 0 }}>
            <Card size="small" styles={{ body: { padding: layoutTokens.contentPadding } }}>
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall, display: 'block' }}>
                Revenue in range
              </Typography.Text>
              <Typography.Text strong style={{ color: colorTokens.textPrimary, fontSize: fontTokens.fontSizeHeading3, display: 'block' }}>
                {formatCurrency(aggregates.revenue)}
              </Typography.Text>
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
                {formatCurrency(aggregates.averageOrderValue)} average · {formatNumber(aggregates.unitsSold)} units
              </Typography.Text>
            </Card>
          </Col>

          <Col xs={12} md={6} style={{ minWidth: 0 }}>
            <Card size="small" styles={{ body: { padding: layoutTokens.contentPadding } }}>
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall, display: 'block' }}>
                Gross profit
              </Typography.Text>
              <Typography.Text strong style={{ color: colorTokens.textPrimary, fontSize: fontTokens.fontSizeHeading3, display: 'block' }}>
                {formatCurrency(aggregates.grossProfit)}
              </Typography.Text>
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
                {formatPercent(aggregates.grossMarginPct)} margin
              </Typography.Text>
            </Card>
          </Col>

          {trackers.map((tracker) => (
            <Col key={tracker.status} xs={12} md={compact ? 12 : 6} style={{ minWidth: 0 }}>
              <Card
                size="small"
                styles={{ body: { padding: layoutTokens.contentPadding } }}
              >
                <Typography.Text
                  style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall, display: 'block' }}
                >
                  {tracker.label} orders
                </Typography.Text>
                <Typography.Text
                  strong
                  style={{ color: colorTokens.textPrimary, fontSize: fontTokens.fontSizeHeading3, display: 'block' }}
                >
                  {formatNumber(tracker.count)}
                </Typography.Text>
                {/* The tracker's own button is the status filter, so the counts
                    above and the rows below can never describe different sets. */}
                <Button
                  type="link"
                  size="small"
                  onClick={() => onStatusChange(filters.status === tracker.status ? ALL_STATUS_FILTER_VALUE : tracker.status)}
                  aria-pressed={filters.status === tracker.status}
                  style={{ minHeight: layoutTokens.touchTargetMinSize, paddingInline: 0 }}
                >
                  {filters.status === tracker.status ? 'Filtering' : 'Filter'} · {formatPercent(tracker.sharePct, 0)}
                </Button>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
          {loading
            ? 'Loading orders…'
            : `${formatNumber(orders.length)} of ${formatNumber(totalCount)} orders shown`}
        </Typography.Text>
        <Button
          onClick={onExport}
          disabled={orders.length === 0}
          style={{ marginLeft: 'auto', minHeight: layoutTokens.touchTargetMinSize }}
        >
          Export CSV
        </Button>
      </div>

      <OrdersTable
        orders={orders}
        loading={loading}
        statusFilter={filters.status}
        onStatusFilterChange={onStatusChange}
        searchQuery={filters.searchQuery}
        onOpenOrder={onOpenOrder}
        onTransition={onTransition}
        mutationsPending={mutationsPending}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onResetFilters}
        scrollY={compact ? 420 : undefined}
        emptyState={
          <EmptyStateView
            variant={hasActiveFilters ? 'filtered' : 'search'}
            title={hasActiveFilters ? 'No orders match these filters' : 'No orders in this range'}
            description={
              hasActiveFilters
                ? 'Reset the filters, or widen the date range to see earlier orders.'
                : 'Orders appear here as soon as the first one is placed in this range.'
            }
            {...(hasActiveFilters
              ? {
                  action: (
                    <Button
                      onClick={onResetFilters}
                      style={{ minHeight: layoutTokens.touchTargetMinSize }}
                    >
                      Reset filters
                    </Button>
                  ),
                }
              : {})}
          />
        }
        toolbarExtra={
          <Button
            type="text"
            onClick={() => onSearchQueryChange('')}
            disabled={filters.searchQuery === ''}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}
          >
            Clear search
          </Button>
        }
      />
    </div>
  );
};

/**
 * The connected sales screen.
 */
export const SalesView: FC = () => {
  const { message, modal } = AntdApp.useApp();
  const { query } = useRouter();

  const [range, setRange] = useState<DateRangeFilter>(() => resolvePresetRange('30d', new Date()));
  const [status, setStatus] = useState<OrderFilters['status']>(ALL_STATUS_FILTER_VALUE);
  const [searchQuery, setSearchQuery] = useState('');
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  const orders = useOrders({
    filters: { dateRange: range, status, searchQuery },
  });
  const mutations = useOrderMutations();
  const productMutations = useProductMutations();

  // A `?status=` deep link mirrors the inventory screen's contract.
  const deepLinkedStatus = query.status;
  useEffect(() => {
    const next = toOrderStatusFilter(deepLinkedStatus);
    if (next === undefined) return;
    setStatus((previous) => (previous === next ? previous : next));
  }, [deepLinkedStatus]);

  const handleTransition = (order: Order, nextStatus: OrderStatus): void => {
    const reverses = nextStatus === 'cancelled' || nextStatus === 'refunded';
    const commit = (): void => {
      void (async () => {
        try {
          await mutations.transitionOrder(order.id, nextStatus, 'Updated from the sales view');
          message.success(`${order.orderNumber} is now ${nextStatus.replace('_', ' ')}.`);
          setOpenOrder((current) => (current?.id === order.id ? { ...current, status: nextStatus } : current));
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : 'The status could not be changed.');
        }
      })();
    };

    // A reversal returns stock and changes revenue, so it is confirmed first.
    if (!reverses) {
      commit();
      return;
    }
    modal.confirm({
      title: `${nextStatus === 'refunded' ? 'Refund' : 'Cancel'} ${order.orderNumber}?`,
      content: describeReversal(nextStatus, order),
      okText: nextStatus === 'refunded' ? 'Refund order' : 'Cancel order',
      okButtonProps: { danger: true },
      onOk: commit,
    });
  };

  const hasActiveFilters =
    status !== ALL_STATUS_FILTER_VALUE || searchQuery.trim() !== '';

  return (
    <>
      <SalesViewBody
        orders={orders.filteredOrders}
        aggregates={orders.aggregates}
        loading={orders.loading}
        totalCount={orders.totalCount}
        range={range}
        onRangeChange={setRange}
        filters={{ status, searchQuery }}
        onStatusChange={setStatus}
        onSearchQueryChange={setSearchQuery}
        onResetFilters={() => {
          setStatus(ALL_STATUS_FILTER_VALUE);
          setSearchQuery('');
        }}
        hasActiveFilters={hasActiveFilters}
        onOpenOrder={setOpenOrder}
        onTransition={handleTransition}
        onExport={() =>
          exportRowsToCsv({
            filename: 'sales-orders',
            columns: salesOrderCsvColumns,
            rows: [...orders.filteredOrders],
          })
        }
        mutationsPending={mutations.pending || productMutations.pending}
        error={orders.error ?? mutations.error}
      />

      <OrderDetailDrawer
        order={openOrder}
        open={openOrder !== null}
        onClose={() => setOpenOrder(null)}
        mutationsPending={mutations.pending || productMutations.pending}
        onTransition={(order, nextStatus) => handleTransition(order, nextStatus)}
        onExport={(order) =>
          exportRowsToCsv({ filename: `order-${order.orderNumber}`, columns: salesOrderCsvColumns, rows: [order] })
        }
      />
    </>
  );
};

export default SalesView;
