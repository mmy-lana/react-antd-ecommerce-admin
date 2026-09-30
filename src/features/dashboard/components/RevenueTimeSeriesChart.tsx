/**
 * Revenue / profit time series (plan Task 3.3).
 *
 * Chart configuration is built by the pure, exported {@link buildRevenueChartConfig}
 * so the mapping from domain points to plot options can be asserted without a
 * canvas. The `chartRenderer` seam keeps `@ant-design/plots` out of the test
 * path and gives the shell a place to lazy-load the plotting runtime.
 *
 * Zoom is implemented as a window over the bucket list rather than a G2
 * `dataZoom` transform: the visible slice stays a plain array, which keeps the
 * interaction deterministic across chart runtimes and makes the window itself
 * directly assertable.
 */

import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Area, type AreaConfig } from '@ant-design/plots';
import { withDisabledAnimation } from './chartAnimation';
import { Button, Segmented, Slider, Space, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode } from 'react';

import { chartSizeTokens } from '../../../app/theme/themeConfig';
import { chartPalette, colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { ChartSkeleton } from '../../../shared/components/feedback/SkeletonBoard';
import { useElementSize, useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber } from '../../../shared/utils/currency';
import { formatBucketKey } from '../../../shared/utils/dateMath';
import type { AggregationInterval, SalesTimeSeriesPoint } from '../../../shared/types';

export type RevenueSeriesKey = 'revenue' | 'profit' | 'ordersCount';

export interface RevenueSeriesDefinition {
  key: RevenueSeriesKey;
  label: string;
  /** True when the series is a currency amount rather than a count. */
  isCurrency: boolean;
}

export const REVENUE_SERIES: readonly RevenueSeriesDefinition[] = [
  { key: 'revenue', label: 'Revenue', isCurrency: true },
  { key: 'profit', label: 'Net Profit', isCurrency: true },
  { key: 'ordersCount', label: 'Orders', isCurrency: false },
] as const;

export const REVENUE_SERIES_LABEL: Record<RevenueSeriesKey, string> = {
  revenue: 'Revenue',
  profit: 'Net Profit',
  ordersCount: 'Orders',
};

export const formatSeriesValue = (series: RevenueSeriesKey, value: number): string =>
  series === 'ordersCount' ? formatNumber(value) : formatCurrency(value);

/* -------------------------------------------------------------------------- */
/* Zoom window                                                                 */
/* -------------------------------------------------------------------------- */

export interface ZoomWindow {
  /** Inclusive start index into the bucket list. */
  startIndex: number;
  /** Inclusive end index into the bucket list. */
  endIndex: number;
}

export const FULL_ZOOM: ZoomWindow = { startIndex: 0, endIndex: 0 };

/** Minimum number of buckets that must remain visible after a zoom. */
export const MIN_ZOOM_BUCKETS = 3;

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/**
 * Normalises a requested window against a dataset length.
 *
 * Returns a degenerate window (`startIndex === endIndex === 0`) for an empty
 * dataset so callers never index past the end.
 */
export const clampZoomWindow = (requested: Partial<ZoomWindow>, length: number): ZoomWindow => {
  if (length <= 0) return { ...FULL_ZOOM };
  const maxIndex = length - 1;
  const start = Math.max(0, Math.min(Math.trunc(requested.startIndex ?? 0), maxIndex));
  const end = Math.max(start, Math.min(Math.trunc(requested.endIndex ?? maxIndex), maxIndex));
  return { startIndex: start, endIndex: end };
};

/** Inclusive slice of the bucket list for a normalised window. */
export const sliceByZoom = <T,>(items: readonly T[], window: ZoomWindow): T[] =>
  items.slice(window.startIndex, window.endIndex + 1);

/** Maps slider percentages (0–100) onto bucket indices. */
export const resolveZoomFromPercent = (percent: readonly number[], length: number): ZoomWindow => {
  if (length <= 0) return { ...FULL_ZOOM };
  const [rawStart = 0, rawEnd = 100] = percent;
  const lastIndex = length - 1;
  const start = Math.round((clampPercent(rawStart) / 100) * lastIndex);
  const end = Math.round((clampPercent(rawEnd) / 100) * lastIndex);
  return clampZoomWindow({ startIndex: start, endIndex: end }, length);
};

/** Inverse of {@link resolveZoomFromPercent}, for seeding the slider. */
export const resolvePercentFromZoom = (window: ZoomWindow, length: number): [number, number] => {
  if (length <= 0) return [0, 100];
  const lastIndex = length - 1;
  return [
    Math.round((window.startIndex / lastIndex) * 100),
    Math.round((window.endIndex / lastIndex) * 100),
  ];
};

/** Nudges the window by `step` buckets, clamped to the dataset. */
export const panZoomWindow = (window: ZoomWindow, length: number, step: number): ZoomWindow =>
  clampZoomWindow({ startIndex: window.startIndex + step, endIndex: window.endIndex + step }, length);

/* -------------------------------------------------------------------------- */
/* Chart configuration                                                         */
/* -------------------------------------------------------------------------- */

export interface RevenueChartConfigInput {
  data: readonly SalesTimeSeriesPoint[];
  series: RevenueSeriesKey;
  interval: AggregationInterval;
  width: number;
  height: number;
}

/**
 * Builds the `@ant-design/plots` area configuration.
 *
 * Colours come from the shared token palette rather than literal hex values so
 * a theme change reaches the chart without touching this file.
 */
export const buildRevenueChartConfig = ({
  data,
  series,
  interval,
  width,
  height,
}: RevenueChartConfigInput): AreaConfig => {
  const definition = REVENUE_SERIES.find((entry) => entry.key === series) ?? REVENUE_SERIES[0];
  const stroke = chartPalette[0];

  // Animation is off on purpose; see `withDisabledAnimation` for the uncaught
  // `TypeError` from G2's path interpolation that it prevents.
  return withDisabledAnimation({
    data: [...data],
    xField: 'date',
    yField: series,
    shapeField: 'smooth',
    width,
    height,
    autoFit: false,
    scale: {
      x: { type: 'band', paddingInner: data.length > 60 ? 0.02 : 0.18 },
      y: {
        nice: true,
        // A forced zero baseline would flatten day-over-day swings; the axis
        // stays honest because every y tick is currency-formatted and labelled.
        zero: false,
        tickFormatter: (value: number) => formatSeriesValue(series, value),
      },
    },
    style: {
      fill: stroke,
      fillOpacity: 0.18,
      stroke,
      lineWidth: 2,
      cursor: 'pointer',
    },
    axis: {
      x: {
        title: false,
        tick: false,
        labelAutoRotate: true,
        labelAutoHide: true,
        labelAutoFlip: false,
        labelFill: colorTokens.textSecondary,
        labelFontSize: fontTokens.fontSizeTiny,
        lineStroke: colorTokens.borderColor,
        tickStroke: colorTokens.borderColor,
      },
      y: {
        title: false,
        labelFill: colorTokens.textTertiary,
        labelFontSize: fontTokens.fontSizeTiny,
        gridStroke: colorTokens.borderColor,
        gridLineWidth: 1,
        gridLineDash: [3, 3],
        line: false,
        tick: false,
      },
    },
    tooltip: {
      title: (datum: SalesTimeSeriesPoint) => formatBucketKey(datum.date, interval),
      items: [
        {
          channel: 'y',
          name: definition.label,
          valueFormatter: (value: unknown) => formatSeriesValue(series, Number(value)),
          color: stroke,
        },
      ],
    },
    interaction: {
      tooltip: { marker: true },
    },
    legend: false,
  });
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface RevenueTimeSeriesChartProps {
  data: readonly SalesTimeSeriesPoint[];
  interval: AggregationInterval;
  onIntervalChange?: (interval: AggregationInterval) => void;
  /** Defaults to `revenue`. */
  series?: RevenueSeriesKey;
  onSeriesChange?: (series: RevenueSeriesKey) => void;
  loading?: boolean;
  /** Replaces the built-in empty state. */
  emptyState?: ReactNode;
  /** Overrides the responsive default height. */
  height?: number;
  /** Injection seam for the plotting runtime. */
  chartRenderer?: (config: AreaConfig) => ReactNode;
}

const INTERVAL_OPTIONS: { label: string; value: AggregationInterval }[] = [
  { label: 'Daily', value: 'day' },
  { label: 'Monthly', value: 'month' },
];

const SERIES_OPTIONS = REVENUE_SERIES.map((entry) => ({ label: entry.label, value: entry.key }));

export const RevenueTimeSeriesChart: FC<RevenueTimeSeriesChartProps> = ({
  data,
  interval,
  onIntervalChange,
  series = 'revenue',
  onSeriesChange,
  loading = false,
  emptyState,
  height,
  chartRenderer,
}) => {
  const compact = useIsCompact();
  const [chartRef, chartSize] = useElementSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<ZoomWindow>(FULL_ZOOM);

  const length = data.length;

  // A new dataset or interval invalidates the stored window: indices from the
  // previous bucket list would point at unrelated dates.
  useEffect(() => {
    setZoom({ startIndex: 0, endIndex: Math.max(0, length - 1) });
  }, [length, interval, series]);

  const activeWindow = clampZoomWindow(zoom, length);
  const visible = useMemo(() => sliceByZoom(data, activeWindow), [data, activeWindow]);
  const zoomPercent = useMemo(
    () => resolvePercentFromZoom(activeWindow, length),
    [activeWindow, length],
  );
  const isZoomed = activeWindow.startIndex > 0 || activeWindow.endIndex < length - 1;

  const resolvedHeight =
    height ?? (compact ? chartSizeTokens.timeSeriesHeightCompact : chartSizeTokens.timeSeriesHeight);
  const resolvedWidth = Math.max(240, Math.trunc(chartSize.width));

  const config = useMemo(
    () =>
      buildRevenueChartConfig({
        data: visible,
        series,
        interval,
        width: resolvedWidth,
        height: resolvedHeight,
      }),
    [visible, series, interval, resolvedWidth, resolvedHeight],
  );

  const handleZoomChange = useCallback(
    (percent: readonly number[]) => setZoom(resolveZoomFromPercent(percent, length)),
    [length],
  );

  const step = Math.max(1, Math.round((activeWindow.endIndex - activeWindow.startIndex + 1) / 4));
  const canZoom = length > MIN_ZOOM_BUCKETS;

  const visibleTotal = visible.reduce(
    (sum, point) => sum + (series === 'ordersCount' ? point.ordersCount : point[series]),
    0,
  );
  const visibleLabel = `${visible.length} of ${length} ${interval === 'day' ? 'days' : 'months'}`;

  const body = (() => {
    if (loading) return <ChartSkeleton title="Revenue trend" height={resolvedHeight} />;

    if (length === 0) {
      return (
        emptyState ?? (
          <EmptyStateView
            variant="filtered"
            title="No sales in this window"
            description="Widen the date range or clear the category filter to plot revenue."
          />
        )
      );
    }

    return (
      <div
        ref={chartRef}
        style={{ width: '100%', minWidth: 0, height: resolvedHeight }}
        role="img"
        aria-label={`${REVENUE_SERIES_LABEL[series]} ${
          interval === 'day' ? 'daily' : 'monthly'
        } chart showing ${visibleLabel}. Visible total ${formatSeriesValue(series, visibleTotal)}.`}
      >
        {chartRenderer ? chartRenderer(config) : <Area {...config} />}
      </div>
    );
  })();

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
        <Space size={8} wrap>
          <Segmented
            size="small"
            aria-label="Time series metric"
            value={series}
            options={SERIES_OPTIONS}
            onChange={(value) => onSeriesChange?.(value as RevenueSeriesKey)}
          />
          <Segmented
            size="small"
            aria-label="Aggregation interval"
            value={interval}
            options={INTERVAL_OPTIONS}
            onChange={(value) => onIntervalChange?.(value as AggregationInterval)}
          />
        </Space>

        <Space size={8} wrap>
          <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
            {visibleLabel}
          </Typography.Text>
          {canZoom ? (
            <>
              <Tooltip title="Pan left">
                <Button
                  size="small"
                  aria-label="Pan chart left"
                  icon={<ZoomOutOutlined />}
                  disabled={activeWindow.startIndex === 0}
                  onClick={() => setZoom(panZoomWindow(activeWindow, length, -step))}
                />
              </Tooltip>
              <Tooltip title="Pan right">
                <Button
                  size="small"
                  aria-label="Pan chart right"
                  icon={<ZoomInOutlined />}
                  disabled={activeWindow.endIndex >= length - 1}
                  onClick={() => setZoom(panZoomWindow(activeWindow, length, step))}
                />
              </Tooltip>
              {isZoomed ? (
                <Button size="small" onClick={() => setZoom({ startIndex: 0, endIndex: length - 1 })}>
                  Reset zoom
                </Button>
              ) : null}
            </>
          ) : null}
        </Space>
      </div>

      {body}

      {canZoom && !loading && length > 0 ? (
        <div style={{ paddingInline: compact ? 0 : 4 }}>
          <Slider
            range
            min={0}
            max={100}
            value={zoomPercent}
            onChange={handleZoomChange}
            aria-label="Zoom the visible time window"
            tooltip={{ formatter: (value) => `${value ?? 0}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

export default RevenueTimeSeriesChart;
