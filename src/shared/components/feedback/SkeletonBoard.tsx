/**
 * Loading fallbacks for analytic widgets (plan Task 2.5).
 *
 * Ant Design's generic `<Skeleton>` cannot imitate the shapes this app actually
 * renders, so each widget has a purpose-built placeholder: a KPI tile keeps the
 * metric grid from reflowing when the real value lands, a chart placeholder
 * holds the exact card height the finished chart will occupy, and the table
 * placeholder reserves one skeleton row per column *and* the measurement
 * columns, so the loading state never causes a layout jump.
 */

import { Card, Skeleton } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { useIsCompact } from '../primitives/ResponsiveContainer';
import { chartSizeTokens } from '../../../app/theme/themeConfig';

const SURFACE_SKELETON = { background: colorTokens.backgroundSubtle };

/* -------------------------------------------------------------------------- */
/* KPI grid                                                                    */
/* -------------------------------------------------------------------------- */

export interface KpiSkeletonGridProps {
  /** Number of placeholder tiles. Defaults to the dashboard's KPI count. */
  count?: number;
  /** Minimum tile height, matching `MetricCard`. */
  minHeight?: number;
}

export const KpiSkeletonGrid: FC<KpiSkeletonGridProps> = ({ count = 4, minHeight }) => {
  const compact = useIsCompact();
  const columns = compact ? 1 : count > 6 ? 4 : 2;

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading key performance indicators"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: layoutTokens.gridGutter,
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} variant="outlined" styles={{ body: { padding: layoutTokens.contentPadding } }}>
          <div style={{ minHeight: minHeight ?? layoutTokens.metricCardMinHeight, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton.Input active size="small" style={{ width: '58%', background: SURFACE_SKELETON.background }} />
            <Skeleton.Input
              active
              size="large"
              style={{ width: '76%', height: 30, background: SURFACE_SKELETON.background }}
            />
            <Skeleton.Input active size="small" style={{ width: '42%', background: SURFACE_SKELETON.background }} />
          </div>
        </Card>
      ))}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Charts                                                                      */
/* -------------------------------------------------------------------------- */

export interface ChartSkeletonProps {
  height?: number;
  title?: ReactNode;
  /** Extra description announced while loading. */
  description?: string;
}

const ChartSkeletonTitle: FC<{ children: ReactNode }> = ({ children }) => (
  <div
    style={{
      color: colorTokens.textPrimary,
      fontSize: fontTokens.fontSizeHeading4,
      fontWeight: 600,
      marginBottom: 6,
    }}
  >
    {children}
  </div>
);

/**
 * Chart placeholder that reserves the exact rendered height.
 *
 * Holding the height is the point: a chart that collapses to 200px and springs
 * back to 320px when data lands pushes every card below it down the page.
 */
export const ChartSkeleton: FC<ChartSkeletonProps> = ({
  height,
  title = 'Loading chart',
  description = 'Chart data is loading',
}) => {
  const compact = useIsCompact();
  const resolvedHeight =
    height ?? (compact ? chartSizeTokens.timeSeriesHeightCompact : chartSizeTokens.timeSeriesHeight);

  return (
    <Card
      variant="outlined"
      aria-busy="true"
      aria-live="polite"
      aria-label={`${typeof title === 'string' ? title : 'Chart'} — loading`}
      styles={{ body: { padding: layoutTokens.contentPadding } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <ChartSkeletonTitle>{title}</ChartSkeletonTitle>
          <Skeleton.Input active size="small" style={{ width: 220, maxWidth: '60%' }} />
        </div>

        <div
          aria-hidden="true"
          style={{
            height: resolvedHeight,
            minWidth: 0,
            borderRadius: 8,
            background: SURFACE_SKELETON.background,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Baseline + a few bar stubs read as "chart" rather than "grey box". */}
          <div
            style={{
              position: 'absolute',
              insetInline: 0,
              bottom: 0,
              height: '58%',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 6,
              paddingInline: 12,
            }}
          >
            {[38, 62, 48, 78, 55, 88, 66, 42].map((heightPct, index) => (
              <div
                key={index}
                style={{
                  flex: 1,
                  height: `${heightPct}%`,
                  borderRadius: '4px 4px 0 0',
                  background: '#e2e8f0',
                }}
              />
            ))}
          </div>
        </div>

        <span className="visually-hidden">{description}</span>
      </div>
    </Card>
  );
};

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

export interface TableSkeletonProps {
  rows?: number;
  /** Mirrors the real table so column widths match once data lands. */
  columnWidths?: readonly number[];
  title?: ReactNode;
}

const DEFAULT_COLUMN_WIDTHS = [180, 120, 100, 140, 96] as const;

export const TableSkeleton: FC<TableSkeletonProps> = ({
  rows = 8,
  columnWidths = DEFAULT_COLUMN_WIDTHS,
  title,
}) => (
  <Card
    variant="outlined"
    aria-busy="true"
    aria-live="polite"
    aria-label="Loading table"
    styles={{ body: { padding: layoutTokens.contentPadding } }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {title ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <span
            style={{
              color: colorTokens.textPrimary,
              fontSize: fontTokens.fontSizeHeading4,
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <Skeleton.Input active size="small" style={{ width: 160 }} />
        </div>
      ) : null}

      {/* Header row */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          paddingBottom: 10,
          borderBottom: `1px solid ${colorTokens.borderColor}`,
        }}
      >
        {columnWidths.map((width, index) => (
          <div
            key={index}
            style={{ flex: '0 0 auto', width, height: 12, borderRadius: 4, background: colorTokens.backgroundSubtle }}
          />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            height: layoutTokens.tableRowHeight,
            borderBottom:
              rowIndex === rows - 1 ? 'none' : `1px solid ${colorTokens.borderColor}`,
          }}
        >
          {columnWidths.map((width, columnIndex) => (
            <div
              key={columnIndex}
              style={{
                flex: '0 0 auto',
                width,
                height: 12,
                borderRadius: 4,
                background: colorTokens.backgroundCanvas,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  </Card>
);

/* -------------------------------------------------------------------------- */
/* Generic board                                                               */
/* -------------------------------------------------------------------------- */

export type SkeletonBoardVariant = 'dashboard' | 'kpi' | 'chart' | 'table' | 'list';

export interface SkeletonBoardProps {
  variant?: SkeletonBoardVariant;
  /** KPI tiles when `variant` is `kpi` or `dashboard`. */
  count?: number;
  /** Skeleton rows when `variant` is `table` or `list`. */
  rows?: number;
  className?: string;
  style?: CSSProperties;
}

export const SkeletonBoard: FC<SkeletonBoardProps> = ({
  variant = 'dashboard',
  count = 4,
  rows = 8,
  className,
  style,
}) => {
  switch (variant) {
    case 'kpi':
      return <KpiSkeletonGrid count={count} />;
    case 'chart':
      return <ChartSkeleton />;
    case 'table':
      return <TableSkeleton rows={rows} />;
    case 'list':
      return <TableSkeleton rows={rows} columnWidths={[220, 140, 100]} />;
    case 'dashboard':
    default:
      return (
        <div
          className={className}
          style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.gridGutter, ...style }}
        >
          <KpiSkeletonGrid count={count} />
          <ChartSkeleton />
        </div>
      );
  }
};

export default SkeletonBoard;
