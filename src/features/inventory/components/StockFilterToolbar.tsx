/**
 * Inventory filter toolbar.
 *
 * Owns no filter state: it renders the caller's `filters` and emits granular
 * changes, so the same toolbar can drive the inventory view and the dashboard
 * without either owning the other's logic.
 *
 * Every control is labelled and reachable by keyboard, and the reset action is
 * only enabled when something is actually filtered — a reset button that does
 * nothing is worse than no button.
 */

import { ClearOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Typography } from 'antd';
import type { FC, ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import {
  PRODUCT_CATEGORIES,
  STOCK_STATUSES,
  STOCK_STATUS_LABEL,
  type CategoryFilter,
  type DashboardFilterState,
  type StockStatusFilter,
} from '../../../shared/types';

export const ALL_FILTER_VALUE = 'all' as const;

export const CATEGORY_FILTER_OPTIONS: readonly { label: string; value: CategoryFilter }[] = [
  { label: 'All categories', value: ALL_FILTER_VALUE },
  ...PRODUCT_CATEGORIES.map((category) => ({ label: category, value: category })),
];

export const STOCK_STATUS_FILTER_OPTIONS: readonly { label: string; value: StockStatusFilter }[] = [
  { label: 'All statuses', value: ALL_FILTER_VALUE },
  ...STOCK_STATUSES.map((status) => ({ label: STOCK_STATUS_LABEL[status], value: status })),
];

/** Pure predicate, so the "is anything filtered" contract is assertable. */
export const hasActiveInventoryFilters = (filters: {
  category: CategoryFilter;
  stockStatus: StockStatusFilter;
  searchQuery: string;
}): boolean =>
  filters.category !== ALL_FILTER_VALUE ||
  filters.stockStatus !== ALL_FILTER_VALUE ||
  filters.searchQuery.trim().length > 0;

export interface StockFilterToolbarProps {
  filters: Pick<DashboardFilterState, 'category' | 'stockStatus' | 'searchQuery'>;
  onCategoryChange: (category: CategoryFilter) => void;
  onStockStatusChange: (status: StockStatusFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onReset: () => void;
  /** Extra controls, e.g. a batch action bar. */
  extra?: ReactNode;
  /** Total before filtering, so the result count is always meaningful. */
  totalCount?: number;
  filteredCount?: number;
}

export const StockFilterToolbar: FC<StockFilterToolbarProps> = ({
  filters,
  onCategoryChange,
  onStockStatusChange,
  onSearchQueryChange,
  onReset,
  extra,
  totalCount,
  filteredCount,
}) => {
  const compact = useIsCompact();
  const active = hasActiveInventoryFilters(filters);

  const countLabel =
    totalCount === undefined || filteredCount === undefined
      ? null
      : active
        ? `${filteredCount} of ${totalCount} products`
        : `${totalCount} products`;

  return (
    <div
      role="search"
      aria-label="Filter inventory"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: layoutTokens.gridGutter,
        minWidth: 0,
      }}
    >
      <Space size={layoutTokens.gridGutter} wrap style={{ flex: 1, minWidth: 0 }}>
        <Input
          allowClear
          value={filters.searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search SKU, name or brand"
          aria-label="Search products by SKU, name or brand"
          prefix={<SearchOutlined aria-hidden="true" />}
          style={{ minWidth: compact ? '100%' : 260, maxWidth: compact ? '100%' : 360 }}
        />

        <Select<CategoryFilter>
          value={filters.category}
          onChange={onCategoryChange}
          options={[...CATEGORY_FILTER_OPTIONS]}
          aria-label="Filter by category"
          style={{ minWidth: 176 }}
        />

        <Select<StockStatusFilter>
          value={filters.stockStatus}
          onChange={onStockStatusChange}
          options={[...STOCK_STATUS_FILTER_OPTIONS]}
          aria-label="Filter by stock status"
          style={{ minWidth: 168 }}
        />

        <Button
          onClick={onReset}
          disabled={!active}
          icon={<ClearOutlined aria-hidden="true" />}
          style={{ minHeight: layoutTokens.touchTargetMinSize }}
        >
          Reset
        </Button>
      </Space>

      <Space size={layoutTokens.gridGutter} wrap>
        {extra}
        {countLabel ? (
          <Typography.Text
            role="status"
            style={{
              color: colorTokens.textSecondary,
              fontSize: fontTokens.fontSizeSmall,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {countLabel}
          </Typography.Text>
        ) : null}
      </Space>
    </div>
  );
};

export default StockFilterToolbar;
