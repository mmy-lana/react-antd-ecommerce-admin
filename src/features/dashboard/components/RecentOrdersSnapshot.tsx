/**
 * Compact "latest orders" panel for the dashboard.
 *
 * Deliberately not a table: at this size a table's column headers and row
 * affordances dominate the panel, and the only action is "open the order".
 * A definition list keeps the order number, customer, total and status
 * scannable while staying a single linear reading order for screen readers.
 */

import { ArrowRightOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Typography } from 'antd';
import { useMemo, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { TableSkeleton } from '../../../shared/components/feedback/SkeletonBoard';
import { StatusBadge } from '../../../shared/components/primitives/StatusBadge';
import { formatCurrency } from '../../../shared/utils/currency';
import { describeRelativeTime, formatUtc } from '../../../shared/utils/dateMath';
import { isRevenueRecognizedOrder, type Order } from '../../../shared/types';

/**
 * Every control in the snapshot — the export button, "view all" and each order
 * row — is a coarse pointer target, matching the rest of the shell.
 */
export const touchTargetStyle = {
  minHeight: layoutTokens.touchTargetMinSize,
  minWidth: layoutTokens.touchTargetMinSize,
} as const;

export const DEFAULT_RECENT_ORDER_COUNT = 6;

export interface RecentOrdersSnapshotProps {
  orders: readonly Order[];
  /** Shown while the query resolves. */
  loading?: boolean;
  /** Maximum rows rendered. Defaults to {@link DEFAULT_RECENT_ORDER_COUNT}. */
  limit?: number;
  onOpenOrder?: (order: Order) => void;
  /** Navigates to the full sales view. */
  onViewAll?: () => void;
  /** Writes the listed orders to a timestamped CSV. */
  onExport?: () => void;
  emptyState?: ReactNode;
  /** Injected so relative times are stable under test. */
  now?: Date;
}

/**
 * Newest first, then by order number so orders created in the same millisecond
 * keep a deterministic order instead of depending on IndexedDB iteration.
 */
export const selectRecentOrders = (
  orders: readonly Order[],
  limit: number = DEFAULT_RECENT_ORDER_COUNT,
): Order[] =>
  [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber))
    .slice(0, Math.max(0, limit));

export const RecentOrdersSnapshot: FC<RecentOrdersSnapshotProps> = ({
  orders,
  loading = false,
  limit = DEFAULT_RECENT_ORDER_COUNT,
  onOpenOrder,
  onViewAll,
  onExport,
  emptyState,
  now,
}) => {
  const recent = useMemo(() => selectRecentOrders(orders, limit), [orders, limit]);

  if (loading) return <TableSkeleton rows={4} columnWidths={[132, 150, 96, 104]} />;

  if (recent.length === 0) {
    return (
      emptyState ?? (
        <EmptyStateView
          size="small"
          title="No recent orders"
          description="Orders appear here as soon as the first one is recorded."
        />
      )
    );
  }

  const grossTotal = recent.reduce(
    (sum, order) => (isRevenueRecognizedOrder(order.status) ? sum + order.totalAmount : sum),
    0,
  );

  return (
    <section aria-label="Recent orders" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Typography.Text style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
          {`${recent.length} most recent orders · ${formatCurrency(grossTotal)} combined`}
        </Typography.Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {onExport ? (
            <Button
              type="text"
              size="small"
              onClick={onExport}
              icon={<DownloadOutlined aria-hidden="true" />}
              aria-label={`Export ${recent.length} recent orders as CSV`}
              style={{ ...touchTargetStyle, color: colorTokens.textSecondary }}
            >
              Export
            </Button>
          ) : null}
          {onViewAll ? (
            <Button
              type="link"
              size="small"
              onClick={onViewAll}
              style={{ ...touchTargetStyle, paddingInline: 0 }}
            >
              View all orders
              <ArrowRightOutlined aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* A plain list rather than a virtualized table: the snapshot is capped at
          a handful of rows, so virtualization would cost semantics for nothing. */}
      {recent.length > 0 ? (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {recent.map((order) => (
            <li
              key={order.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                paddingBlock: 10,
                paddingInline: 0,
                borderBlockEnd: `1px solid ${colorTokens.borderColor}`,
                minHeight: layoutTokens.tableRowHeight,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Typography.Text
                    strong
                    style={{ color: colorTokens.textPrimary, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {order.orderNumber}
                  </Typography.Text>
                  <StatusBadge domain="order" status={order.status} size="small" />
                </div>
                <Typography.Text
                  ellipsis
                  style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall, maxWidth: '100%' }}
                >
                  {`${order.customer.name} · ${order.customer.country}`}
                </Typography.Text>
                <span className="visually-hidden">
                  {`Placed ${formatUtc(order.createdAt, 'MMM D, YYYY')}, ${describeRelativeTime(order.createdAt, now)}, `}
                  {`${order.items.length} line ${order.items.length === 1 ? 'item' : 'items'}, total ${formatCurrency(order.totalAmount)}.`}
                </span>
              </div>

              <Typography.Text
                strong
                style={{
                  color: colorTokens.textPrimary,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatCurrency(order.totalAmount)}
              </Typography.Text>

              {onOpenOrder ? (
                <Button
                  type="link"
                  size="small"
                  className="table-action-button"
                  onClick={() => onOpenOrder(order)}
                >
                  View
                  <span className="visually-hidden">{` order ${order.orderNumber}`}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

export default RecentOrdersSnapshot;
