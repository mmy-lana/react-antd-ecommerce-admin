/**
 * Orders table (plan Task 3.5).
 *
 * Status filters and per-row transition triggers are driven by
 * `ALLOWED_ORDER_TRANSITIONS`, never by a hand-maintained list: the state
 * machine in `shared/types` is the only place the lifecycle is defined, so the
 * UI cannot offer an illegal transition.
 *
 * The transition control is a real `<select>`-free custom button group rather
 * than a dropdown, so every legal target is a single focusable target with a
 * 44px hit area and its new status named in the accessible label.
 */

import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Segmented, Space, Table, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ColumnType } from 'antd/es/table/interface';
import type { Key } from 'antd/es/table/interface';
import { useMemo, type CSSProperties, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView, FilteredEmptyState } from '../../../shared/components/feedback/EmptyStateView';
import { TableSkeleton } from '../../../shared/components/feedback/SkeletonBoard';
import { StatusBadge } from '../../../shared/components/primitives/StatusBadge';
import { useIsCompact, useTouchTargetStyle } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber } from '../../../shared/utils/currency';
import { formatUtc } from '../../../shared/utils/dateMath';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  allowedOrderTransitions,
  isRevenueRecognizedOrder,
  isTerminalOrderStatus,
  type Order,
  type OrderStatus,
  type OrderStatusFilter,
} from '../../../shared/types';

export const ORDERS_VIRTUAL_HEIGHT = 600;

/** Column-width summing; see {@link resolveTableWidth} in `InventoryTable`. */
const resolveTableWidth = (columns: readonly Pick<ColumnType<Record<string, unknown>>, 'width'>[]): number =>
  columns.reduce((total, column) => total + (typeof column.width === 'number' ? column.width : 0), 0);

export const ORDERS_STATUS_FILTER_OPTIONS: readonly { label: string; value: OrderStatusFilter }[] = [
  { label: 'All', value: 'all' },
  ...ORDER_STATUSES.map((status) => ({ label: ORDER_STATUS_LABEL[status], value: status })),
];

export const touchTarget: CSSProperties = {
  minWidth: layoutTokens.touchTargetMinSize,
  minHeight: layoutTokens.touchTargetMinSize,
  padding: 8,
};

/**
 * Legal next statuses for an order, tagged with the settlement consequence so
 * the row can warn before a refund reverses recognised revenue.
 */
export interface OrderTransitionOption {
  status: OrderStatus;
  label: string;
  /** True when the transition returns stock and reverses revenue. */
  reversesRevenue: boolean;
  danger: boolean;
}

export const buildTransitionOptions = (order: Order): OrderTransitionOption[] =>
  allowedOrderTransitions(order.status).map((status) => ({
    status,
    label: ORDER_STATUS_LABEL[status],
    reversesRevenue: !isRevenueRecognizedOrder(status),
    danger: status === 'refunded',
  }));

export interface OrdersTableProps {
  orders: readonly Order[];
  loading?: boolean;
  statusFilter?: OrderStatusFilter;
  onStatusFilterChange?: (status: OrderStatusFilter) => void;
  searchQuery?: string;
  onOpenOrder?: (order: Order) => void;
  onTransition?: (order: Order, nextStatus: OrderStatus) => void;
  /** Disables every transition trigger while a mutation is in flight. */
  mutationsPending?: boolean;
  onExport?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  emptyState?: ReactNode;
  scrollY?: number;
  /** Shown above the table, e.g. a selection action bar. */
  toolbarExtra?: ReactNode;
}

export const OrdersTable: FC<OrdersTableProps> = ({
  orders,
  loading = false,
  statusFilter = 'all',
  onStatusFilterChange,
  searchQuery,
  onOpenOrder,
  onTransition,
  mutationsPending = false,
  onExport,
  hasActiveFilters = false,
  onClearFilters,
  emptyState,
  scrollY = ORDERS_VIRTUAL_HEIGHT,
  toolbarExtra,
}) => {
  const compact = useIsCompact();
  const { style: pointerTargetStyle } = useTouchTargetStyle();

  const recognised = useMemo(
    () => orders.reduce((sum, order) => (isRevenueRecognizedOrder(order.status) ? sum + order.totalAmount : sum), 0),
    [orders],
  );

  const columns = useMemo<TableColumnsType<Order>>(() => {
    const result: TableColumnsType<Order> = [
      {
        title: 'Order',
        dataIndex: 'orderNumber',
        key: 'orderNumber',
        fixed: 'left',
        width: compact ? 132 : 168,
        sorter: (a: Order, b: Order) => a.orderNumber.localeCompare(b.orderNumber),
        render: (orderNumber: string, order: Order) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Typography.Text strong style={{ color: colorTokens.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
              {orderNumber}
            </Typography.Text>
            {compact ? null : (
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
                {`${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}`}
              </Typography.Text>
            )}
          </div>
        ),
      },
      {
        title: 'Customer',
        key: 'customer',
        width: compact ? 160 : 240,
        render: (_: unknown, order: Order) => (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography.Text
              ellipsis={{ tooltip: `${order.customer.name} — ${order.customer.email}` }}
              style={{ color: colorTokens.textPrimary, maxWidth: '100%' }}
            >
              {order.customer.name}
            </Typography.Text>
            <Typography.Text
              ellipsis={{ tooltip: order.customer.email }}
              style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny, maxWidth: '100%' }}
            >
              {order.customer.email}
            </Typography.Text>
          </div>
        ),
      },
    ];

    if (!compact) {
      result.push({
        title: 'Country',
        dataIndex: ['customer', 'country'],
        key: 'country',
        width: 160,
        render: (country: string) => (
          <Typography.Text style={{ color: colorTokens.textSecondary }}>{country}</Typography.Text>
        ),
      });
    }

    result.push({
      title: 'Placed',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 168,
      sorter: (a: Order, b: Order) => a.createdAt.localeCompare(b.createdAt),
      defaultSortOrder: 'descend',
      render: (createdAt: string) => (
        <Typography.Text style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
          {formatUtc(createdAt, compact ? 'MMM D, YYYY' : 'MMM D, YYYY HH:mm')}
        </Typography.Text>
      ),
    });

    result.push({
      title: 'Total',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      align: 'right',
      width: 148,
      sorter: (a: Order, b: Order) => a.totalAmount - b.totalAmount,
      render: (total: number, order: Order) => {
        // Cancelled and refunded orders are shown struck through so the total
        // column is never read as settled revenue.
        const recognisedOrder = isRevenueRecognizedOrder(order.status);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Typography.Text
              strong
              style={{
                color: recognisedOrder ? colorTokens.textPrimary : colorTokens.textTertiary,
                fontVariantNumeric: 'tabular-nums',
                textDecoration: recognisedOrder ? 'none' : 'line-through',
              }}
            >
              {formatCurrency(total)}
            </Typography.Text>
            {!recognisedOrder ? (
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
                not recognised
              </Typography.Text>
            ) : null}
          </div>
        );
      },
    });

    result.push({
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: OrderStatus) => <StatusBadge domain="order" status={status} size="small" />,
    });

    result.push({
      title: 'Actions',
      key: 'actions',
      align: 'right',
      fixed: 'right',
      width: 116,
      render: (_: unknown, order: Order) => {
        const transitions = buildTransitionOptions(order);
        return (
          <Space size={0} wrap={false} onClick={(event) => event.stopPropagation()}>
            {onOpenOrder ? (
              <Tooltip title="Open order">
                <Button
                  type="text"
                  className="table-action-button"
                  aria-label={`Open order ${order.orderNumber}`}
                  icon={<EyeOutlined />}
                  style={{ ...touchTarget, ...pointerTargetStyle }}
                  onClick={() => onOpenOrder(order)}
                />
              </Tooltip>
            ) : null}

            {transitions.length === 0 ? (
              // Terminal states get an explicit, non-interactive explanation
              // rather than an empty cell.
              <Tooltip title={`${order.status === 'cancelled' ? 'Cancelled' : 'Refunded'} orders cannot change status`}>
                <span
                  className="table-action-button"
                  aria-label={`Order ${order.orderNumber} is ${ORDER_STATUS_LABEL[order.status]}; no further status changes are possible`}
                  style={{
                    ...touchTarget,
                    ...pointerTargetStyle,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colorTokens.textTertiary,
                    cursor: 'not-allowed',
                  }}
                >
                  <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
                    {isTerminalOrderStatus(order.status) ? 'Final' : '—'}
                  </Typography.Text>
                </span>
              </Tooltip>
            ) : (
              transitions.map((transition) => (
                <Tooltip
                  key={transition.status}
                  title={
                    transition.reversesRevenue
                      ? `Mark ${ORDER_STATUS_LABEL[transition.status]} — returns stock and reverses recognised revenue`
                      : `Mark ${ORDER_STATUS_LABEL[transition.status]}`
                  }
                >
                  <Button
                    type="text"
                    className="table-action-button"
                    aria-label={`Mark order ${order.orderNumber} as ${ORDER_STATUS_LABEL[transition.status]}`}
                    disabled={mutationsPending}
                    danger={transition.danger}
                    style={{ ...touchTarget, ...pointerTargetStyle }}
                    onClick={() => onTransition?.(order, transition.status)}
                  >
                    {transition.label}
                  </Button>
                </Tooltip>
              ))
            )}
          </Space>
        );
      },
    });

    return result;
  }, [compact, mutationsPending, onOpenOrder, onTransition, pointerTargetStyle]);

  if (loading) return <TableSkeleton rows={10} columnWidths={[168, 240, 168, 148, 150, 200]} />;

  if (orders.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    if (hasActiveFilters && onClearFilters) return <FilteredEmptyState onClearFilters={onClearFilters} />;
    return (
      <EmptyStateView
        title="No orders yet"
        description="Orders appear here as soon as the first one is recorded in this workspace."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.gridGutter, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: layoutTokens.gridGutter,
        }}
      >
        {onStatusFilterChange ? (
          <Segmented
            size="small"
            aria-label="Filter orders by status"
            value={statusFilter}
            onChange={(value) => onStatusFilterChange(value as OrderStatusFilter)}
            options={[...ORDERS_STATUS_FILTER_OPTIONS]}
          />
        ) : (
          <Typography.Text style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
            {`${formatNumber(orders.length)} ${orders.length === 1 ? 'order' : 'orders'}`}
          </Typography.Text>
        )}

        <Space size={layoutTokens.gridGutter} wrap>
          {toolbarExtra}
          <Typography.Text
            style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall, fontVariantNumeric: 'tabular-nums' }}
          >
            {`${formatNumber(orders.length)} shown · ${formatCurrency(recognised)} recognised`}
          </Typography.Text>
          {onExport ? (
            <Button
              size="small"
              icon={<DownloadOutlined aria-hidden="true" />}
              onClick={onExport}
              style={{ minHeight: layoutTokens.touchTargetMinSize }}
            >
              Export CSV
            </Button>
          ) : null}
        </Space>
      </div>

      {searchQuery ? (
        <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
          {`Matching “${searchQuery}”`}
        </Typography.Text>
      ) : null}

      <div className="no-horizontal-overflow" style={{ minWidth: 0 }}>
        <Table<Order>
          rowKey={(order: Order) => order.id as Key}
          columns={columns}
          dataSource={[...orders]}
          size={compact ? 'small' : 'middle'}
          loading={false}
          scroll={{ x: Math.max(resolveTableWidth(columns), scrollY + 1), y: scrollY }}
          virtual
          sticky
          onRow={(order: Order) =>
            onOpenOrder
              ? { onClick: () => onOpenOrder(order), style: { cursor: 'pointer' } }
              : {}
          }
          locale={{ emptyText: 'No orders match the current filters' }}
        />
      </div>
    </div>
  );
};

export default OrdersTable;
