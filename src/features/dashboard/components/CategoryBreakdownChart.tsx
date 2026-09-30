/**
 * Category revenue breakdown (plan Task 3.4).
 *
 * A donut plus a legend that is a real, wrapping list rather than the chart
 * library's built-in legend. Slices are keyboard-activatable so "click a slice
 * to filter the rest of the dashboard" is reachable without a pointer — the
 * library's canvas hit areas are not.
 *
 * The click-to-filter behaviour is surfaced as an `onCategorySelect` callback;
 * the legend rows are the accessible control that drives it.
 */

import { Pie, type PieConfig } from '@ant-design/plots';
import { withDisabledAnimation } from './chartAnimation';
import { Typography } from 'antd';
import { useCallback, useMemo, useState, type FC, type ReactNode } from 'react';

import { chartSizeTokens } from '../../../app/theme/themeConfig';
import { chartPalette, colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { ChartSkeleton } from '../../../shared/components/feedback/SkeletonBoard';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber, formatPercent } from '../../../shared/utils/currency';
import type { CategorySalesPoint } from '../../../shared/types';

/** Categories beyond this count are grouped so the donut stays readable. */
export const MAX_LEGEND_SLICES = 8;

export interface CategoryDonutSlice {
  category: string;
  revenue: number;
  unitsSold: number;
  percentage: number;
  color: string;
}

export interface CategoryBreakdownChartProps {
  data: readonly CategorySalesPoint[];
  loading?: boolean;
  /** Currently applied category filter, highlighted in the legend. */
  selectedCategory?: string;
  /** `undefined` clears the filter. */
  onCategorySelect?: (category: string | undefined) => void;
  emptyState?: ReactNode;
  height?: number;
  /** Injection seam for the plotting runtime. */
  chartRenderer?: (config: PieConfig) => ReactNode;
}

/**
 * Sorts by revenue, keeps the top {@link MAX_LEGEND_SLICES} and folds the rest
 * into a single "Other" slice so the palette never repeats colours and the
 * legend never overflows.
 */
export const buildCategorySlices = (
  data: readonly CategorySalesPoint[],
  maxSlices: number = MAX_LEGEND_SLICES,
): CategoryDonutSlice[] => {
  const sorted = [...data]
    .filter((point) => point.revenue > 0 || point.unitsSold > 0)
    .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));

  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);

  const slices: CategoryDonutSlice[] = head.map((point, index) => ({
    category: point.category,
    revenue: point.revenue,
    unitsSold: point.unitsSold,
    percentage: point.percentage,
    color: chartPalette[index % chartPalette.length],
  }));

  if (tail.length > 0) {
    const revenue = tail.reduce((sum, point) => sum + point.revenue, 0);
    const unitsSold = tail.reduce((sum, point) => sum + point.unitsSold, 0);
    const percentage = tail.reduce((sum, point) => sum + point.percentage, 0);
    slices.push({
      category: OTHER_CATEGORY_LABEL,
      revenue,
      unitsSold,
      percentage,
      color: colorTokens.borderColorStrong,
    });
  }

  return slices;
};

export const OTHER_CATEGORY_LABEL = 'Other';

export interface CategoryDonutConfigInput {
  slices: readonly CategoryDonutSlice[];
  width: number;
  height: number;
  totalRevenue: number;
}

export const buildCategoryDonutConfig = ({
  slices,
  width,
  height,
  totalRevenue,
}: CategoryDonutConfigInput): PieConfig => withDisabledAnimation({
  data: slices.map((slice) => ({ category: slice.category, revenue: slice.revenue })),
  angleField: 'revenue',
  colorField: 'category',
  innerRadius: 0.62,
  radius: 0.92,
  width,
  height,
  autoFit: false,
  scale: {
    color: { range: slices.map((slice) => slice.color) },
  },
  labels: [],
  legend: false,
  style: {
    stroke: '#ffffff',
    lineWidth: 2,
    cursor: 'pointer',
  },
  tooltip: {
    title: (datum: { category?: string; revenue?: number }) => datum.category ?? '',
    items: [
      {
        channel: 'y',
        name: 'Revenue',
        valueFormatter: (value: unknown) => formatCurrency(Number(value)),
      },
    ],
  },
  interaction: { elementSelect: false },
  // A doughnut with a hole needs a label there; the total is rendered in DOM
  // text instead so it is selectable and readable by assistive technology.
  meta: { totalRevenue },
});

export const CategoryBreakdownChart: FC<CategoryBreakdownChartProps> = ({
  data,
  loading = false,
  selectedCategory,
  onCategorySelect,
  emptyState,
  height,
  chartRenderer,
}) => {
  const compact = useIsCompact();
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const slices = useMemo(() => buildCategorySlices(data), [data]);
  /**
   * Line-item gross subtotal, not settled order revenue.
   *
   * `buildRevenueByCategory` sums each order line's `subtotal` and never adds
   * order-level discount, tax, or shipping, so this figure is deliberately
   * larger than the "Total Revenue" KPI. The centre caption says
   * "Product Sales" for exactly this reason — the two numbers are not
   * reconcilable against each other and must not claim to be.
   */
  const totalRevenue = useMemo(
    () => slices.reduce((sum, slice) => sum + slice.revenue, 0),
    [slices],
  );

  const resolvedHeight =
    height ?? (compact ? chartSizeTokens.donutHeightCompact : chartSizeTokens.donutHeight);
  const resolvedWidth = compact ? resolvedHeight : Math.max(200, Math.round(resolvedHeight * 0.9));

  const config = useMemo(
    () => buildCategoryDonutConfig({ slices, width: resolvedWidth, height: resolvedHeight, totalRevenue }),
    [slices, resolvedWidth, resolvedHeight, totalRevenue],
  );

  const handleSelect = useCallback(
    (category: string) => {
      // The "Other" bucket is an aggregate, not a real category; selecting it
      // would produce a filter that matches nothing.
      if (category === OTHER_CATEGORY_LABEL) return;
      onCategorySelect?.(selectedCategory === category ? undefined : category);
    },
    [onCategorySelect, selectedCategory],
  );

  if (loading) return <ChartSkeleton title="Revenue by category" height={resolvedHeight} />;

  if (slices.length === 0) {
    return (
      emptyState ?? (
        <EmptyStateView
          variant="filtered"
          title="No category revenue in this window"
          description="Once orders settle in the selected date range each category's share of revenue appears here."
        />
      )
    );
  }

  const highlighted = hoveredCategory ?? selectedCategory ?? null;

  return (
    <div
      // Always stacked, never a row. The chart lives in an `xl={8}` column —
    // roughly a third of a 1440px viewport — and a side-by-side donut and
    // legend left the legend ~200px, which ellipsised every category name and
    // pushed the revenue and percentage columns out of view. Stacking gives the
    // legend the full column width, so all three fields read in full.
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: layoutTokens.contentPadding,
      minWidth: 0,
    }}
  >
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          // Centred within the column rather than pinned to its start edge.
          marginInline: 'auto',
          width: resolvedWidth,
          height: resolvedHeight,
        }}
        role="img"
        aria-label={`Donut chart of revenue by category. ${slices
          .map((slice) => `${slice.category} ${formatPercent(slice.percentage)}`)
          .join(', ')}.`}
      >
        {chartRenderer ? (
          chartRenderer(config)
        ) : (
          <Pie {...config} />
        )}

        {/* Centre total, drawn in DOM so it stays selectable and translatable. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: fontTokens.fontSizeHeading4,
              fontWeight: 700,
              color: colorTokens.textPrimary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatCurrency(totalRevenue, { maximumFractionDigits: 0 })}
          </span>
          <span style={{ fontSize: fontTokens.fontSizeTiny, color: colorTokens.textTertiary }}>
            Product Sales
          </span>
        </div>
      </div>

      {/* Legend doubles as the accessible click-to-filter control. */}
      <ul
        aria-label="Revenue by category — select a category to filter"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          minWidth: 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: '100%',
        }}
      >
        {slices.map((slice) => {
          const isSelected = selectedCategory === slice.category;
          const isDimmed = highlighted !== null && highlighted !== slice.category;
          const isAggregate = slice.category === OTHER_CATEGORY_LABEL;

          return (
            <li key={slice.category}>
              <button
                type="button"
                disabled={isAggregate || onCategorySelect === undefined}
                aria-pressed={isSelected}
                onClick={() => handleSelect(slice.category)}
                onMouseEnter={() => setHoveredCategory(slice.category)}
                onMouseLeave={() => setHoveredCategory(null)}
                onFocus={() => setHoveredCategory(slice.category)}
                onBlur={() => setHoveredCategory(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  minHeight: layoutTokens.touchTargetMinSize,
                  paddingInline: 8,
                  paddingBlock: 4,
                  border: `1px solid ${isSelected ? slice.color : 'transparent'}`,
                  borderRadius: 8,
                  background: isSelected ? `${slice.color}14` : 'transparent',
                  opacity: isDimmed ? 0.5 : 1,
                  cursor: isAggregate || onCategorySelect === undefined ? 'default' : 'pointer',
                  textAlign: 'start',
                  transition: 'opacity 120ms, background-color 120ms',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: slice.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  title={slice.category}
                  style={{
                    // The name takes the slack; the two numeric columns are
                    // `flexShrink: 0` so a long category name can never squeeze
                    // the currency or the percentage out of the row. Ellipsis
                    // is kept only as a last resort for a pathological name.
                    flex: '1 1 auto',
                    minWidth: 0,
                    color: colorTokens.textPrimary,
                    fontSize: fontTokens.fontSizeSmall,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {slice.category}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    color: colorTokens.textSecondary,
                    fontSize: fontTokens.fontSizeSmall,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCurrency(slice.revenue, { maximumFractionDigits: 0 })}
                </span>
                <Typography.Text
                  style={{
                    flexShrink: 0,
                    color: colorTokens.textTertiary,
                    fontSize: fontTokens.fontSizeTiny,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 48,
                    textAlign: 'end',
                  }}
                >
                  {formatPercent(slice.percentage)}
                </Typography.Text>
              </button>
              <span className="visually-hidden">
                {formatNumber(slice.unitsSold)} units sold.
                {isAggregate
                  ? ' Grouped categories; not selectable.'
                  : isSelected
                    ? ' Currently applied as a filter.'
                    : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CategoryBreakdownChart;
