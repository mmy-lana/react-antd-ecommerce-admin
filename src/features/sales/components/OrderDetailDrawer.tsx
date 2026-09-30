/**
 * Order detail drawer (plan Task 3.6).
 *
 * Width follows the plan's overlay contract exactly:
 * `width={viewportWidth < 480 ? '100%' : 460}` — below 480px a drawer that is
 * 460px wide would itself be a horizontal scroll source.
 *
 * Line items, customer facts, the fulfilment cost profile and a lifecycle
 * timeline are shown together so a support agent can answer "what happened to
 * this order" without leaving the list.
 *
 * Status mutation triggers are generated from `ALLOWED_ORDER_TRANSITIONS`;
 * the component never decides which transitions are legal.
 */

import { ExportOutlined } from '@ant-design/icons';
import { Button, Descriptions, Divider, Drawer, Space, Table, Timeline, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { StatusBadge } from '../../../shared/components/primitives/StatusBadge';
import { useOverlayWidth } from '../../../shared/components/primitives/ResponsiveContainer';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber, formatPercent } from '../../../shared/utils/currency';
import { formatUtc } from '../../../shared/utils/dateMath';
import { buildTransitionOptions } from './OrdersTable';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  isRevenueRecognizedOrder,
  type Order,
  type OrderItem,
  type OrderStatus,
} from '../../../shared/types';

/** Fixed overlay width, matching the plan's `viewportWidth < 480 ? 100% : 460`. */
export const DRAWER_BASE_WIDTH = 460;

export interface OrderDetailDrawerProps {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onTransition?: (order: Order, nextStatus: OrderStatus) => void;
  mutationsPending?: boolean;
  onExport?: (order: Order) => void;
  /** Overrides the computed width; primarily for storybook-style previews. */
  width?: number | string;
  title?: ReactNode;
}

const costBreakdownItems = (order: Order) => {
  const cost = order.items.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
  const grossProfit = order.totalAmount - cost;
  return [
    { key: 'subtotal', label: 'Subtotal', value: formatCurrency(order.subtotal) },
    { key: 'discount', label: 'Discount', value: `-${formatCurrency(order.discountAmount)}` },
    { key: 'tax', label: 'Tax', value: formatCurrency(order.taxAmount) },
    { key: 'shipping', label: 'Shipping', value: formatCurrency(order.shippingFee) },
    { key: 'total', label: 'Order total', value: formatCurrency(order.totalAmount), strong: true },
    { key: 'cost', label: 'Cost of goods', value: formatCurrency(cost) },
    {
      key: 'profit',
      label: 'Net profit',
      value: formatCurrency(grossProfit),
      strong: true,
      tone: grossProfit >= 0 ? 'positive' : 'negative',
    },
    {
      key: 'margin',
      label: 'Margin',
      value:
        order.totalAmount > 0 ? formatPercent((grossProfit / order.totalAmount) * 100) : formatPercent(0),
    },
  ];
};

/**
 * The drawer's content, exported separately from the overlay shell.
 *
 * Ant Design overlays mount through a portal, so the panel cannot be rendered
 * without a document. Keeping the body and the transition bar as plain
 * components means the content is testable on its own and the shell stays a
 * thin wrapper with no logic of its own.
 */
export const OrderDetailBody: FC<{ order: Order }> = ({ order }) => {
  const compact = useIsCompact();

  const itemColumns = useMemo<TableColumnsType<OrderItem>>(
    () => [
      {
        title: 'Item',
        key: 'item',
        render: (_: unknown, item: OrderItem) => (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography.Text style={{ color: colorTokens.textPrimary }}>{item.productName}</Typography.Text>
            <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
              {item.sku}
            </Typography.Text>
          </div>
        ),
      },
      {
        title: 'Qty',
        dataIndex: 'quantity',
        key: 'quantity',
        align: 'right',
        width: 56,
        render: (quantity: number) => (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(quantity)}</span>
        ),
      },
      {
        title: 'Unit price',
        dataIndex: 'unitPrice',
        key: 'unitPrice',
        align: 'right',
        width: 104,
        render: (unitPrice: number) => formatCurrency(unitPrice),
      },
      {
        title: 'Subtotal',
        dataIndex: 'subtotal',
        key: 'subtotal',
        align: 'right',
        width: 112,
        render: (subtotal: number) => (
          <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(subtotal)}
          </Typography.Text>
        ),
      },
    ],
    [],
  );

  const timelineEntries = useMemo(() => {
    if (!order) return [];
    return [
      {
        color: colorTokens.primary,
        content: (
          <div>
            <Typography.Text strong>Order placed</Typography.Text>
            <Typography.Text
              style={{ display: 'block', color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}
            >
              {formatUtc(order.createdAt, 'MMM D, YYYY HH:mm')} UTC
            </Typography.Text>
          </div>
        ),
      },
      {
        color:
          new Date(order.updatedAt).getTime() > new Date(order.createdAt).getTime()
            ? colorTokens.success
            : colorTokens.borderColorStrong,
        content: (
          <div>
            <Typography.Text strong>
              {new Date(order.updatedAt).getTime() > new Date(order.createdAt).getTime()
                ? `Last updated — ${ORDER_STATUS_LABEL[order.status]}`
                : 'Awaiting fulfilment'}
            </Typography.Text>
            <Typography.Text
              style={{ display: 'block', color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}
            >
              {formatUtc(order.updatedAt, 'MMM D, YYYY HH:mm')} UTC
            </Typography.Text>
          </div>
        ),
      },
      ...(isRevenueRecognizedOrder(order.status)
        ? []
        : [
            {
              color: colorTokens.warning,
              content: (
                <div>
                  <Typography.Text strong>Revenue not recognised</Typography.Text>
                  <Typography.Text
                    style={{ display: 'block', color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}
                  >
                    {`${ORDER_STATUS_LABEL[order.status]} orders are excluded from revenue, profit and sales-volume aggregates.`}
                  </Typography.Text>
                </div>
              ),
            },
          ]),
    ];
  }, [order]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.contentPadding }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Typography.Text strong style={{ color: colorTokens.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
          {order.orderNumber}
        </Typography.Text>
        <StatusBadge domain="order" status={order.status} />
        <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
          {`Placed ${formatUtc(order.createdAt, 'MMM D, YYYY HH:mm')} UTC`}
        </Typography.Text>
      </div>

        <Descriptions
          size="small"
          column={1}
          title="Customer"
          items={[
            { key: 'name', label: 'Name', children: order.customer.name },
            { key: 'email', label: 'Email', children: order.customer.email },
            { key: 'country', label: 'Country', children: order.customer.country },
            {
              key: 'history',
              label: 'Lifetime orders',
              children: formatNumber(order.customer.totalOrdersCount),
            },
            { key: 'payment', label: 'Payment', children: PAYMENT_METHOD_LABEL[order.paymentMethod] },
          ]}
        />

        <Divider titlePlacement="start" plain style={{ marginInline: 0 }}>
          Line items
        </Divider>

        <Table<OrderItem>
          rowKey="id"
          columns={itemColumns}
          dataSource={order.items}
          size="small"
          pagination={false}
          scroll={{ x: compact ? 360 : 'max-content' }}
          locale={{ emptyText: 'This order has no line items' }}
        />

        <Divider titlePlacement="start" plain style={{ marginInline: 0 }}>
          Fulfilment cost profile
        </Divider>

        <Descriptions
          size="small"
          column={1}
          items={costBreakdownItems(order).map((entry) => ({
            key: entry.key,
            label: entry.label,
            // `children`, not `content`: `DescriptionsItemProps` exposes the cell
            // body as `children` and has no `content` key at all, so `content`
            // was dropped on the floor and every row rendered an empty cell
            // beside its label.
            children: (
              <Typography.Text
                strong={entry.strong}
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    entry.tone === 'negative'
                      ? colorTokens.error
                      : entry.tone === 'positive'
                        ? colorTokens.success
                        : colorTokens.textPrimary,
                }}
              >
                {entry.value}
              </Typography.Text>
            ),
          }))}
        />

        <Divider titlePlacement="start" plain style={{ marginInline: 0 }}>
          Lifecycle
        </Divider>

        <Timeline items={timelineEntries} />
    </div>
  );
};

/**
 * Status triggers for the drawer footer, derived entirely from the state
 * machine so the component never decides which transitions are legal.
 *
 * A transition into a non-recognised status returns stock and reverses revenue;
 * that consequence is announced rather than left for the user to discover.
 */
export const OrderTransitionBar: FC<{
  order: Order;
  onTransition: (order: Order, nextStatus: OrderStatus) => void;
  mutationsPending?: boolean;
}> = ({ order, onTransition, mutationsPending = false }) => {
  const options = buildTransitionOptions(order);

  if (options.length === 0) {
    return (
      <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
        {`${ORDER_STATUS_LABEL[order.status]} is a final status — this order can no longer change.`}
      </Typography.Text>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Typography.Text style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
        Move this order to:
      </Typography.Text>
      <Space size={layoutTokens.gridGutter} wrap>
        {options.map((option) => (
          <Button
            key={option.status}
            danger={option.danger}
            disabled={mutationsPending}
            onClick={() => onTransition(order, option.status)}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}
          >
            {option.label}
            <span className="visually-hidden">
              {option.reversesRevenue
                ? ` — returns stock and reverses revenue`
                : ` — advances the order lifecycle`}
            </span>
          </Button>
        ))}
      </Space>
    </div>
  );
};

/** Overlay shell: width, title, export trigger and the transition bar. */
export const OrderDetailDrawer: FC<OrderDetailDrawerProps> = ({
  order,
  open,
  onClose,
  onTransition,
  mutationsPending = false,
  onExport,
  width,
  title,
}) => {
  const computedWidth = useOverlayWidth(DRAWER_BASE_WIDTH);
  const drawerTitle = title ?? (order ? order.orderNumber : 'Order');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={width ?? computedWidth}
      title={drawerTitle}
      aria-label={order ? `Order ${order.orderNumber} details` : 'Order details'}
      destroyOnHidden
      extra={
        order && onExport ? (
          <Button
            size="small"
            icon={<ExportOutlined aria-hidden="true" />}
            onClick={() => onExport(order)}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}
          >
            Export
          </Button>
        ) : null
      }
      footer={
        order && onTransition ? (
          <OrderTransitionBar order={order} onTransition={onTransition} mutationsPending={mutationsPending} />
        ) : null
      }
    >
      {order === null ? null : <OrderDetailBody order={order} />}
    </Drawer>
  );
};

export default OrderDetailDrawer;
