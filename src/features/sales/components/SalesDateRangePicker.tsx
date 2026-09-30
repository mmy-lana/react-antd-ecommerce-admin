/**
 * Date range control for the sales analytics.
 *
 * Works entirely in UTC: the selected day is interpreted as a UTC day
 * boundary, never a host-local midnight, so a report generated in
 * UTC+13 and one generated in UTC-8 cover the same instants.
 *
 * Presets are expressed in days back from *today in UTC*, which is what the
 * reporting model uses everywhere else.
 */

import { CalendarOutlined } from '@ant-design/icons';
import { Button, DatePicker, Select, Space, Typography } from 'antd';
import { useMemo, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import {
  createRelativeDateRange,
  describeDateRange,
  differenceInUtcDays,
  toIsoUtcString,
  toUtcDayjs,
} from '../../../shared/utils/dateMath';
import type { DateRangeFilter } from '../../../shared/types';

export type DateRangePresetKey =
  | '7d'
  | '30d'
  | '90d'
  | '180d'
  | '365d'
  | 'ytd'
  | 'all'
  | 'custom';

export interface DateRangePreset {
  key: DateRangePresetKey;
  label: string;
  /** Whole days back from today. `undefined` for unbounded presets. */
  days?: number;
}

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '180d', label: 'Last 6 months', days: 180 },
  { key: '365d', label: 'Last 12 months', days: 365 },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
];

/** `all` starts at the epoch; the store never holds earlier orders. */
export const ALL_TIME_START = '1970-01-01T00:00:00.000Z';

export const resolvePresetRange = (
  key: DateRangePresetKey,
  now: Date = new Date(),
): DateRangeFilter => {
  if (key === 'all') {
    return { startDate: ALL_TIME_START, endDate: toIsoUtcString(now) };
  }
  if (key === 'ytd') {
    const today = toUtcDayjs(now);
    return { startDate: toIsoUtcString(today.startOf('year')), endDate: toIsoUtcString(now) };
  }
  if (key === 'custom') {
    return createRelativeDateRange(30, now);
  }
  const preset = DATE_RANGE_PRESETS.find((entry) => entry.key === key);
  return createRelativeDateRange(preset?.days ?? 30, now);
};

/** Identifies which preset, if any, matches the supplied range exactly. */
export const matchPreset = (
  range: DateRangeFilter,
  now: Date = new Date(),
): DateRangePresetKey => {
  for (const preset of DATE_RANGE_PRESETS) {
    if (preset.key === 'custom') continue;
    const candidate = resolvePresetRange(preset.key, now);
    if (
      toUtcDayjs(candidate.startDate).valueOf() === toUtcDayjs(range.startDate).valueOf() &&
      toUtcDayjs(candidate.endDate).valueOf() === toUtcDayjs(range.endDate).valueOf()
    ) {
      return preset.key;
    }
  }
  return 'custom';
};

export interface SalesDateRangePickerProps {
  value: DateRangeFilter;
  onChange: (range: DateRangeFilter) => void;
  /** Days the picker should offer; defaults to 365. */
  maxRangeDays?: number;
  disabled?: boolean;
  extra?: ReactNode;
  /** Injected so preset matching is deterministic under test. */
  now?: Date;
}

export const SalesDateRangePicker: FC<SalesDateRangePickerProps> = ({
  value,
  onChange,
  maxRangeDays = 365,
  disabled = false,
  extra,
  now,
}) => {
  const compact = useIsCompact();
  const reference = useMemo(() => now ?? new Date(), [now]);
  const activePreset = useMemo(() => matchPreset(value, reference), [value, reference]);
  const span = differenceInUtcDays(value.endDate, value.startDate);

  const presetOptions = useMemo(
    () =>
      DATE_RANGE_PRESETS.map((preset) => {
        const range = preset.key === 'custom' ? null : resolvePresetRange(preset.key, reference);
        const days = range ? differenceInUtcDays(range.endDate, range.startDate) : 0;
        // Anything longer than the store holds cannot be selected.
        const outOfBounds = preset.key !== 'custom' && preset.key !== 'all' && days > maxRangeDays;
        return {
          label: outOfBounds ? `${preset.label} (beyond ${maxRangeDays}-day limit)` : preset.label,
          value: preset.key,
          disabled: outOfBounds,
        };
      }),
    [reference, maxRangeDays],
  );

  const handlePresetChange = (key: DateRangePresetKey): void => {
    onChange(resolvePresetRange(key, reference));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: layoutTokens.gridGutter,
        minWidth: 0,
      }}
    >
      <Space size={layoutTokens.gridGutter} wrap>
        <Select<DateRangePresetKey>
          value={activePreset}
          onChange={handlePresetChange}
          options={presetOptions}
          disabled={disabled}
          aria-label="Reporting period preset"
          style={{ minWidth: 176 }}
        />

        <DatePicker.RangePicker
          allowClear={false}
          disabled={disabled}
          value={[toUtcDayjs(value.startDate), toUtcDayjs(value.endDate)]}
          onChange={(dates) => {
            if (!dates?.[0] || !dates?.[1]) return;
            onChange({
              startDate: toIsoUtcString(dates[0].startOf('day')),
              endDate: toIsoUtcString(dates[1].endOf('day')),
            });
          }}
          format="MMM D, YYYY"
          aria-label="Custom reporting period"
          style={{ minWidth: compact ? '100%' : 264 }}
          presets={DATE_RANGE_PRESETS.filter((preset) => preset.days !== undefined).map((preset) => ({
            label: preset.label,
            value: [toUtcDayjs(resolvePresetRange(preset.key, reference).startDate),
              toUtcDayjs(resolvePresetRange(preset.key, reference).endDate)],
          }))}
        />
      </Space>

      <Space size={8} wrap>
        <CalendarOutlined aria-hidden="true" style={{ color: colorTokens.textTertiary }} />
        <Typography.Text
          style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}
        >
          {describeDateRange(value)}
        </Typography.Text>
        <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
          {`${span + 1} ${span === 0 ? 'day' : 'days'} (UTC)`}
        </Typography.Text>
        {activePreset === 'custom' ? (
          <Button
            size="small"
            onClick={() => handlePresetChange('30d')}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}
          >
            Reset to 30 days
          </Button>
        ) : null}
      </Space>

      {extra}
    </div>
  );
};

export default SalesDateRangePicker;
