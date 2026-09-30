/**
 * UTC-boundary date math.
 *
 * Every persisted timestamp is an ISO 8601 UTC string, and every query boundary
 * derived here is snapped to a UTC day edge before it reaches IndexedDB. Without
 * that normalization a user in UTC+13 filtering "today" would silently read the
 * previous day's bucket, and month buckets would drift by one label.
 */

import dayjs, { type Dayjs } from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';

import type { AggregationInterval, DateRangeFilter, ISODateString } from '../types';

dayjs.extend(utc);
dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);
dayjs.extend(relativeTime);

/** Tokens understood by every UTC key produced in this module. */
export const UTC_DAY_KEY_FORMAT = 'YYYY-MM-DD' as const;
export const UTC_MONTH_KEY_FORMAT = 'YYYY-MM' as const;

/** Display formats, all rendered against UTC boundaries. */
export const UTC_DISPLAY_FORMATS = {
  day: 'MMM D, YYYY',
  dayShort: 'MMM D',
  month: 'MMMM YYYY',
  monthShort: 'MMM YYYY',
  quarter: 'Q YYYY',
  dateTime: 'MMM D, YYYY HH:mm',
} as const satisfies Record<string, string>;

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Above this many day buckets a daily series stops being readable, so charts
 * switch to monthly aggregation.
 */
export const MAX_DAILY_BUCKETS = 62;

/* -------------------------------------------------------------------------- */
/* Parsing + serialization                                                    */
/* -------------------------------------------------------------------------- */

export const isValidIsoString = (value: unknown): value is ISODateString =>
  typeof value === 'string' && ISO_8601_PATTERN.test(value) && dayjs.utc(value).isValid();

/** Coerces a `Date`, dayjs instance or ISO string into a UTC-mode dayjs object. */
export const toUtcDayjs = (value: Date | Dayjs | string): Dayjs => {
  const parsed = dayjs.utc(value instanceof Date ? value : value);
  if (!parsed.isValid()) {
    throw new RangeError(`Invalid ISO 8601 timestamp: ${String(value)}`);
  }
  return parsed;
};

/** Canonical storage form: UTC ISO 8601 with millisecond precision and a `Z` suffix. */
export const toIsoUtcString = (value: Date | Dayjs | string): ISODateString =>
  toUtcDayjs(value).toISOString();

export const nowIsoUtc = (): ISODateString => dayjs.utc().toISOString();

/** Accepts an empty picker value, a `Date`, or a raw ISO string. */
export const toIsoUtcBoundary = (value: Date | string | null | undefined): ISODateString => {
  if (value === null || value === undefined || value === '') {
    return nowIsoUtc();
  }
  return toIsoUtcString(value);
};

/* -------------------------------------------------------------------------- */
/* UTC boundaries                                                             */
/* -------------------------------------------------------------------------- */

export const startOfUtcDay = (value: Date | Dayjs | string): Dayjs =>
  toUtcDayjs(value).startOf('day');

export const endOfUtcDay = (value: Date | Dayjs | string): Dayjs =>
  toUtcDayjs(value).endOf('day');

export const startOfUtcMonth = (value: Date | Dayjs | string): Dayjs =>
  toUtcDayjs(value).startOf('month');

export const endOfUtcMonth = (value: Date | Dayjs | string): Dayjs =>
  toUtcDayjs(value).endOf('month');

export const addUtcDays = (value: Date | Dayjs | string, amount: number): Dayjs =>
  toUtcDayjs(value).add(amount, 'day');

export const addUtcMonths = (value: Date | Dayjs | string, amount: number): Dayjs =>
  toUtcDayjs(value).add(amount, 'month');

/** Whole UTC days between two instants, floored. */
export const differenceInUtcDays = (
  later: Date | Dayjs | string,
  earlier: Date | Dayjs | string,
): number => toUtcDayjs(later).startOf('day').diff(toUtcDayjs(earlier).startOf('day'), 'day');

/* -------------------------------------------------------------------------- */
/* Range construction + predicates                                            */
/* -------------------------------------------------------------------------- */

/**
 * Snaps an arbitrary pair of instants to inclusive UTC day boundaries and
 * repairs inverted input so `startDate <= endDate` always holds.
 */
export const normalizeDateRange = (
  start: Date | Dayjs | string,
  end: Date | Dayjs | string,
): DateRangeFilter => {
  let startBoundary = startOfUtcDay(start);
  let endBoundary = endOfUtcDay(end);

  if (startBoundary.isAfter(endBoundary)) {
    const swap = startBoundary;
    startBoundary = startOfUtcDay(end);
    endBoundary = endOfUtcDay(swap);
  }

  return {
    startDate: startBoundary.toISOString(),
    endDate: endBoundary.toISOString(),
  };
};

/** The trailing `days` UTC days ending on the reference day (defaults to now). */
export const createRelativeDateRange = (
  days: number,
  reference?: Date | Dayjs | string,
): DateRangeFilter => {
  const anchor = reference === undefined ? dayjs.utc() : toUtcDayjs(reference);
  const span = Math.max(1, Math.trunc(days));
  return normalizeDateRange(anchor.subtract(span - 1, 'day'), anchor);
};

export const isWithinUtcRange = (timestamp: string, range: DateRangeFilter): boolean => {
  if (!isValidIsoString(timestamp)) return false;
  const point = toUtcDayjs(timestamp).valueOf();
  return (
    point >= toUtcDayjs(range.startDate).valueOf() && point <= toUtcDayjs(range.endDate).valueOf()
  );
};

export const isSameUtcDay = (a: Date | Dayjs | string, b: Date | Dayjs | string): boolean =>
  toUtcDayjs(a).isSame(toUtcDayjs(b), 'day');

/** Derives the immediately preceding window of equal length, for growth deltas. */
export const getPreviousPeriod = (range: DateRangeFilter): DateRangeFilter => {
  const start = startOfUtcDay(range.startDate);
  const end = endOfUtcDay(range.endDate);
  const lengthInDays = differenceInUtcDays(end, start) + 1;
  const previousEnd = start.subtract(1, 'day').endOf('day');
  const previousStart = previousEnd.subtract(lengthInDays - 1, 'day').startOf('day');
  return normalizeDateRange(previousStart, previousEnd);
};

/* -------------------------------------------------------------------------- */
/* Bucket keys + axis enumeration                                             */
/* -------------------------------------------------------------------------- */

export const utcDayKey = (value: Date | Dayjs | string): string =>
  toUtcDayjs(value).format(UTC_DAY_KEY_FORMAT);

export const utcMonthKey = (value: Date | Dayjs | string): string =>
  toUtcDayjs(value).format(UTC_MONTH_KEY_FORMAT);

export const bucketKeyFor = (value: Date | Dayjs | string, interval: AggregationInterval): string =>
  interval === 'day' ? utcDayKey(value) : utcMonthKey(value);

/**
 * Produces a gap-free list of bucket keys so charts draw a continuous axis even
 * when a day or month recorded zero orders.
 */
export const enumerateBucketKeys = (
  range: DateRangeFilter,
  interval: AggregationInterval,
): string[] => {
  const keys: string[] = [];
  const limit = endOfUtcDay(range.endDate).valueOf();

  if (interval === 'day') {
    let cursor = startOfUtcDay(range.startDate);
    while (cursor.valueOf() <= limit) {
      keys.push(cursor.format(UTC_DAY_KEY_FORMAT));
      cursor = cursor.add(1, 'day');
    }
    return keys;
  }

  let cursor = startOfUtcMonth(range.startDate);
  while (cursor.valueOf() <= limit) {
    keys.push(cursor.format(UTC_MONTH_KEY_FORMAT));
    cursor = cursor.add(1, 'month');
  }
  return keys;
};

/** Chooses `day` for short windows and `month` for anything longer. */
export const resolveAggregationInterval = (range: DateRangeFilter): AggregationInterval =>
  differenceInUtcDays(range.endDate, range.startDate) + 1 <= MAX_DAILY_BUCKETS ? 'day' : 'month';

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

export const formatUtc = (
  value: Date | Dayjs | string,
  template: string = UTC_DISPLAY_FORMATS.dateTime,
): string => toUtcDayjs(value).format(template);

export const formatBucketKey = (key: string, interval: AggregationInterval): string =>
  toUtcDayjs(key).format(
    interval === 'day' ? UTC_DISPLAY_FORMATS.dayShort : UTC_DISPLAY_FORMATS.monthShort,
  );

/** Human label for an active filter, e.g. `Jul 1 – Jul 30, 2026`. */
export const describeDateRange = (range: DateRangeFilter): string => {
  const start = toUtcDayjs(range.startDate);
  const end = toUtcDayjs(range.endDate);

  if (start.isSame(end, 'day')) {
    return start.format(UTC_DISPLAY_FORMATS.day);
  }
  if (start.isSame(end, 'month') && start.isSame(end, 'year')) {
    return `${start.format(UTC_DISPLAY_FORMATS.dayShort)} – ${end.format(UTC_DISPLAY_FORMATS.day)}`;
  }
  return `${start.format(UTC_DISPLAY_FORMATS.day)} – ${end.format(UTC_DISPLAY_FORMATS.day)}`;
};

/** `2 days ago` style relative stamp used in audit trails and log tables. */
export const describeRelativeTime = (
  value: Date | Dayjs | string,
  reference?: Date | Dayjs | string,
): string => toUtcDayjs(value).from(reference === undefined ? dayjs.utc() : toUtcDayjs(reference));
