/**
 * Inventory table (plan Task 3.1).
 *
 * Responsive column strategy:
 *  - `>= 768px`  — full set, horizontally scrollable via `scroll={{ x: 'max-content' }}`
 *  - `480–767px` — price and brand fold away; stock and status stay
 *  - `< 480px`   — SKU, product name, total stock and actions only, with every
 *                  other field (variants, price, thresholds) inside the
 *                  expandable row panel
 *
 * Variant detail always lives in the expandable panel, so the collapsed phone
 * view carries the same information the desktop table does.
 *
 * Ant Design's `Table` virtualizes rows itself through `virtual` + `scroll.y`;
 * the table is wrapped in a height-constrained region so long product lists do
 * not produce an unbounded DOM. Row selection is keyboard operable through
 * `rowSelection`, and every action trigger is at least 44x44px.
 */

import { InboxOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Button, Descriptions, Space, Table, Tooltip, Typography } from 'antd';
import type { Key } from 'antd/es/table/interface';
import type { TableColumnsType } from 'antd';
import { virtualTableSemantics } from '../../../shared/components/table/virtualTableSemantics';
import type { ColumnType } from 'antd/es/table/interface';
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import {
  EmptyStateView,
  FilteredEmptyState,
} from '../../../shared/components/feedback/EmptyStateView';
import { TableSkeleton } from '../../../shared/components/feedback/SkeletonBoard';
import { StatusBadge } from '../../../shared/components/primitives/StatusBadge';
import {
  useIsCompact,
  useTouchTargetStyle,
  useViewportSize,
} from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber, formatPercent } from '../../../shared/utils/currency';
import { formatUtc } from '../../../shared/utils/dateMath';
import { activeVariants, unitMargin } from '../../../shared/utils/stockStatus';
import type { Product, ProductVariant, UUID } from '../../../shared/types';

export type InventorySortKey = 'name' | 'sku' | 'category' | 'totalStock' | 'basePrice' | 'updatedAt';

/** Virtual window height; the body scrolls, the header sticks. */
export const INVENTORY_VIRTUAL_HEIGHT = 560;

export interface InventoryColumnDensity {
  /** `compact` < 480px, `tablet` 480–767px, `desktop` >= 768px. */
  density: 'compact' | 'tablet' | 'desktop';
  showCategory: boolean;
  showBrand: boolean;
  showPrice: boolean;
  showMargin: boolean;
  showUpdatedAt: boolean;
  showStatus: boolean;
}

/** Pure column-visibility rule, so the breakpoint contract is assertable. */
export const resolveColumnDensity = (viewportWidth: number): InventoryColumnDensity => {
  if (viewportWidth < 480) {
    return {
      density: 'compact',
      showCategory: false,
      showBrand: false,
      showPrice: false,
      showMargin: false,
      showUpdatedAt: false,
      showStatus: true,
    };
  }
  if (viewportWidth < 768) {
    return {
      density: 'tablet',
      showCategory: true,
      showBrand: false,
      showPrice: true,
      showMargin: false,
      showUpdatedAt: false,
      showStatus: true,
    };
  }
  return {
    density: 'desktop',
    showCategory: true,
    showBrand: true,
    showPrice: true,
    showMargin: true,
    showUpdatedAt: true,
    showStatus: true,
  };
};

export interface InventoryRowAction {
  key: 'edit' | 'restock' | 'adjust' | 'archive';
  label: string;
  icon: ReactNode;
  onClick: (product: Product) => void;
  /** Hides the trigger for products where the action is meaningless. */
  isAvailable?: (product: Product) => boolean;
  danger?: boolean;
}

export interface InventoryTableProps {
  products: readonly Product[];
  loading?: boolean;
  /** Externally controlled selection, e.g. for batch restock. */
  selectedRowKeys?: readonly UUID[];
  onSelectedRowKeysChange?: (keys: UUID[]) => void;
  onRowClick?: (product: Product) => void;
  rowActions?: readonly InventoryRowAction[];
  /** Enables the "show archived only" affordance when provided. */
  onToggleArchivedView?: () => void;
  showArchivedOnly?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Height of the virtualized scroll region. */
  scrollY?: number;
  emptyState?: ReactNode;
  /** Footer content below the table, e.g. the selection action bar. */
  footer?: ReactNode;
}

const touchTargetStyle: CSSProperties = {
  minWidth: layoutTokens.touchTargetMinSize,
  minHeight: layoutTokens.touchTargetMinSize,
  padding: 8,
};

const MARGIN_WARNING_THRESHOLD_PCT = 20;

/**
 * Total width of the visible columns.
 *
 * The plan calls for a table that scrolls horizontally rather than overflowing
 * its container. Ant Design's `virtual` table cannot honour `x: 'max-content'`:
 * rc-table silently replaces a non-numeric `x` with `1`, which collapses every
 * column. Passing the summed widths gives the same scrolling behaviour with the
 * number rc-table actually needs.
 */
export const resolveTableWidth = (columns: readonly Pick<ColumnType<Record<string, unknown>>, 'width'>[]): number =>
  columns.reduce((total, column) => total + (typeof column.width === 'number' ? column.width : 0), 0);

/** Row keys are product ids; keeping them explicit documents the contract. */
export const toRowKey = (product: Product): UUID => product.id;

const VariantSummaryTable: FC<{ variants: readonly ProductVariant[] }> = ({ variants }) => (
  <Table<ProductVariant>
    size="small"
    rowKey="id"
    pagination={false}
    scroll={{ x: 'max-content' }}
    dataSource={variants.map((variant) => ({ ...variant, key: variant.id }))}
    columns={[
      {
        title: 'Variant',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        render: (name: string, variant: ProductVariant) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Typography.Text strong style={{ color: colorTokens.textPrimary }}>
              {name}
            </Typography.Text>
            <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
              {variant.sku}
            </Typography.Text>
          </div>
        ),
      },
      {
        title: 'Price',
        dataIndex: 'price',
        key: 'price',
        align: 'right',
        render: (price: number) => formatCurrency(price),
      },
      {
        title: 'Cost',
        dataIndex: 'costPrice',
        key: 'costPrice',
        align: 'right',
        render: (cost: number) => formatCurrency(cost),
      },
      {
        title: 'Margin',
        key: 'margin',
        align: 'right',
        render: (_: unknown, variant: ProductVariant) => {
          const margin = unitMargin(variant.price, variant.costPrice);
          const marginPct = variant.price > 0 ? (margin / variant.price) * 100 : 0;
          return (
            <Typography.Text
              style={{
                color: margin < 0 ? colorTokens.error : colorTokens.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatPercent(marginPct)}
            </Typography.Text>
          );
        },
      },
      {
        title: 'Stock',
        dataIndex: 'stockQuantity',
        key: 'stockQuantity',
        align: 'right',
        render: (stock: number, variant: ProductVariant) => (
          <span
            style={{
              color:
                stock === 0
                  ? colorTokens.error
                  : stock <= variant.safetyStockThreshold
                    ? colorTokens.warning
                    : colorTokens.textPrimary,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(stock)}
          </span>
        ),
      },
      {
        title: 'Safety threshold',
        dataIndex: 'safetyStockThreshold',
        key: 'safetyStockThreshold',
        align: 'right',
        render: (threshold: number) => formatNumber(threshold),
      },
    ]}
  />
);

export const InventoryTable: FC<InventoryTableProps> = ({
  products,
  loading = false,
  selectedRowKeys,
  onSelectedRowKeysChange,
  onRowClick,
  rowActions = [],
  onToggleArchivedView,
  showArchivedOnly = false,
  hasActiveFilters = false,
  onClearFilters,
  scrollY = INVENTORY_VIRTUAL_HEIGHT,
  emptyState,
  footer,
}) => {
  const compact = useIsCompact();
  const { style: pointerTargetStyle } = useTouchTargetStyle();
  const [expandedKeys, setExpandedKeys] = useState<readonly UUID[]>([]);

  // The viewport hook is the single source of truth for the breakpoint
  // contract and already coalesces resize bursts into a single frame.
  const { width: viewportWidth } = useViewportSize();
  const density = resolveColumnDensity(viewportWidth);
  const hasVariants = useMemo(() => products.some((product) => activeVariants(product).length > 0), [products]);

  const handleExpand = useCallback(
    (keys: readonly Key[]) => setExpandedKeys(keys.map(String) as readonly UUID[]),
    [],
  );

  const columns = useMemo<TableColumnsType<Product>>(() => {
    const result: TableColumnsType<Product> = [
      {
        title: 'SKU',
        dataIndex: 'sku',
        key: 'sku',
        fixed: 'left',
        width: compact ? 116 : 148,
        render: (sku: string) => (
          <Typography.Text style={{ color: colorTokens.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
            {sku}
          </Typography.Text>
        ),
      },
      {
        title: 'Product',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        width: compact ? 180 : 260,
        render: (name: string, product: Product) => (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography.Text
              strong
              ellipsis={{ tooltip: name }}
              style={{ color: colorTokens.textPrimary, maxWidth: '100%' }}
            >
              {name}
            </Typography.Text>
            {density.showBrand ? (
              <Typography.Text
                ellipsis
                style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny, maxWidth: '100%' }}
              >
                {product.brand}
              </Typography.Text>
            ) : null}
          </div>
        ),
      },
    ];

    if (density.showCategory) {
      result.push({
        title: 'Category',
        dataIndex: 'category',
        key: 'category',
        width: 168,
        render: (category: string) => (
          <Typography.Text style={{ color: colorTokens.textSecondary }}>{category}</Typography.Text>
        ),
      });
    }

    result.push({
      title: 'Total stock',
      dataIndex: 'totalStock',
      key: 'totalStock',
      align: 'right',
      width: 128,
      sorter: (a: Product, b: Product) => a.totalStock - b.totalStock,
      defaultSortOrder: undefined,
      render: (totalStock: number, product: Product) => {
        const shortfall = product.safetyStockThreshold - totalStock;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Typography.Text
              strong
              style={{
                color:
                  totalStock === 0
                    ? colorTokens.error
                    : totalStock <= product.safetyStockThreshold
                      ? colorTokens.warning
                      : colorTokens.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatNumber(totalStock)}
            </Typography.Text>
            {shortfall > 0 ? (
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
                {`${formatNumber(shortfall)} below threshold`}
              </Typography.Text>
            ) : null}
          </div>
        );
      },
    });

    if (density.showStatus) {
      result.push({
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 140,
        render: (status: Product['status']) => <StatusBadge domain="stock" status={status} size="small" />,
      });
    }

    if (density.showPrice) {
      result.push({
        title: 'Price',
        dataIndex: 'basePrice',
        key: 'basePrice',
        align: 'right',
        width: 124,
        sorter: (a: Product, b: Product) => a.basePrice - b.basePrice,
        render: (price: number, product: Product) => {
          const marginPct = price > 0 ? (unitMargin(price, product.baseCost) / price) * 100 : 0;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <Typography.Text style={{ color: colorTokens.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(price)}
              </Typography.Text>
              {density.showMargin ? (
                <Typography.Text
                  style={{
                    color: marginPct < MARGIN_WARNING_THRESHOLD_PCT ? colorTokens.warning : colorTokens.textTertiary,
                    fontSize: fontTokens.fontSizeTiny,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatPercent(marginPct)}
                </Typography.Text>
              ) : null}
            </div>
          );
        },
      });
    }

    if (density.showUpdatedAt) {
      result.push({
        title: 'Updated',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        // Fits "UPDATED" plus the sorter arrows plus the cell padding. At 156
        // the label ellipsised to "Updat…", which hid both the column's meaning
        // and the fact that it is sortable.
        width: 172,
        sorter: (a: Product, b: Product) => a.updatedAt.localeCompare(b.updatedAt),
        render: (updatedAt: string) => (
          <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
            {formatUtc(updatedAt, 'MMM D, YYYY')}
          </Typography.Text>
        ),
      });
    }

    result.push({
      title: 'Actions',
      key: 'actions',
      align: 'right',
      fixed: 'right',
      width: rowActions.length > 0 ? 48 * Math.min(rowActions.length, 4) + 24 : 64,
      render: (_: unknown, product: Product) => (
        <Space size={0} wrap={false} onClick={(event) => event.stopPropagation()}>
          {rowActions.map((action) => {
            const available = action.isAvailable ? action.isAvailable(product) : true;
            const trigger = (
              <Button
                key={action.key}
                type="text"
                className="table-action-button"
                aria-label={`${action.label} ${product.name}`}
                icon={action.icon}
                disabled={!available}
                danger={action.danger}
                style={{ ...touchTargetStyle, ...pointerTargetStyle }}
                onClick={() => action.onClick(product)}
              />
            );
            // Tooltips do not fire for disabled buttons, so the trigger is only
            // wrapped when it is actually actionable.
            return available ? (
              <Tooltip key={action.key} title={action.label}>
                {trigger}
              </Tooltip>
            ) : (
              trigger
            );
          })}
        </Space>
      ),
    });

    return result;
  }, [compact, density, rowActions, pointerTargetStyle]);

  if (loading) return <TableSkeleton rows={10} columnWidths={[148, 260, 128, 140, 124, 220]} />;

  if (products.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    if (hasActiveFilters && onClearFilters) {
      return <FilteredEmptyState onClearFilters={onClearFilters} />;
    }
    return (
      <EmptyStateView
        title="No products yet"
        description="Products appear here once they are created. Archived products are hidden from this list."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.gridGutter, minWidth: 0 }}>
      {onToggleArchivedView ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            icon={<InboxOutlined aria-hidden="true" />}
            onClick={onToggleArchivedView}
            aria-pressed={showArchivedOnly}
          >
            {showArchivedOnly ? 'Showing archived' : 'Show archived'}
          </Button>
        </div>
      ) : null}

      <div className="no-horizontal-overflow" style={{ minWidth: 0 }}>
        <Table<Product>
          rowKey={toRowKey}
          columns={columns}
          dataSource={[...products]}
          size={compact ? 'small' : 'middle'}
          loading={false}
          scroll={{ x: Math.max(resolveTableWidth(columns), scrollY + 1), y: scrollY }}
          virtual
          components={virtualTableSemantics<Product>()}
          sticky
          expandable={
            hasVariants
              ? {
                  expandedRowKeys: [...expandedKeys],
                  onExpandedRowsChange: handleExpand,
                  expandIcon: ({ expanded, onExpand, record }) => (
                    <Button
                      type="text"
                      className="table-action-button"
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} variants of ${record.name}`}
                      aria-expanded={expanded}
                      icon={<UnorderedListOutlined />}
                      onClick={(event) => onExpand(record, event)}
                    />
                  ),
                  rowExpandable: (product: Product) => activeVariants(product).length > 0,
                  expandedRowRender: (product: Product) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBlock: 4 }}>
                      {product.description ? (
                        <Typography.Paragraph
                          style={{ margin: 0, color: colorTokens.textSecondary, maxWidth: 720 }}
                        >
                          {product.description}
                        </Typography.Paragraph>
                      ) : null}

                      <Descriptions
                        size="small"
                        bordered
                        column={{ xs: 1, sm: 2, md: 3 }}
                        items={[
                          {
                            key: 'category',
                            label: 'Category',
                            children: product.category,
                          },
                          {
                            key: 'brand',
                            label: 'Brand',
                            children: product.brand,
                          },
                          {
                            key: 'price',
                            label: 'Base price',
                            children: formatCurrency(product.basePrice),
                          },
                          {
                            key: 'cost',
                            label: 'Base cost',
                            children: formatCurrency(product.baseCost),
                          },
                          {
                            key: 'margin',
                            label: 'Margin',
                            children: formatPercent(
                              product.basePrice > 0
                                ? (unitMargin(product.basePrice, product.baseCost) / product.basePrice) * 100
                                : 0,
                            ),
                          },
                          {
                            key: 'threshold',
                            label: 'Safety threshold',
                            children: formatNumber(product.safetyStockThreshold),
                          },
                          {
                            key: 'status',
                            label: 'Status',
                            children: <StatusBadge domain="stock" status={product.status} size="small" />,
                          },
                          {
                            key: 'updated',
                            label: 'Last updated',
                            children: formatUtc(product.updatedAt, 'MMM D, YYYY HH:mm'),
                          },
                          {
                            key: 'created',
                            label: 'Created',
                            children: formatUtc(product.createdAt, 'MMM D, YYYY HH:mm'),
                          },
                        ]}
                      />

                      {activeVariants(product).length > 0 ? (
                        <VariantSummaryTable variants={activeVariants(product)} />
                      ) : null}

                      {product.tags.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {product.tags.map((tag) => (
                            <Typography.Text
                              key={tag}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: colorTokens.backgroundSubtle,
                                color: colorTokens.textSecondary,
                                fontSize: fontTokens.fontSizeTiny,
                              }}
                            >
                              {tag}
                            </Typography.Text>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                }
              : undefined
          }
          rowSelection={
            onSelectedRowKeysChange
              ? {
                  selectedRowKeys: [...(selectedRowKeys ?? [])],
                  onChange: (keys) => onSelectedRowKeysChange(keys as UUID[]),
                  preserveSelectedRowKeys: true,
                  columnWidth: compact ? 40 : 48,
                }
              : undefined
          }
          onRow={(product: Product) => ({
            onClick: onRowClick ? () => onRowClick(product) : undefined,
            style: onRowClick
              ? { cursor: 'pointer' }
              : undefined,
          })}
          locale={{
            emptyText: hasActiveFilters ? 'No products match the current filters' : 'No products',
          }}
        />
      </div>

      {footer}
    </div>
  );
};

export default InventoryTable;
