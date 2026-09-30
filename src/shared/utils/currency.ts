/**
 * Currency and numeric presentation helpers.
 *
 * Every money value in the domain is a plain `number` in the store's base
 * currency (USD) with 2-decimal precision. `Intl.NumberFormat` instances are
 * expensive to construct and these helpers run inside table render loops, so
 * formatters are memoized by their full option signature.
 */

export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_LOCALE = 'en-US';

export interface CurrencyFormatOptions {
  currency?: string;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** `notation` is forwarded so charts and KPI tiles can opt into compact output. */
  notation?: 'standard' | 'compact';
  display?: 'symbol' | 'code' | 'name';
}

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

const buildCurrencyCacheKey = (options: Required<CurrencyFormatOptions>): string =>
  [
    options.locale,
    options.currency,
    options.display,
    options.notation,
    options.minimumFractionDigits,
    options.maximumFractionDigits,
  ].join('|');

const getCurrencyFormatter = (options: Required<CurrencyFormatOptions>): Intl.NumberFormat => {
  const key = buildCurrencyCacheKey(options);
  const cached = currencyFormatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: options.currency,
    currencyDisplay: options.display,
    notation: options.notation,
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  });

  currencyFormatterCache.set(key, formatter);
  return formatter;
};

const resolveCurrencyOptions = (options: CurrencyFormatOptions = {}): Required<CurrencyFormatOptions> => {
  const notation = options.notation ?? 'standard';
  const compact = notation === 'compact';
  const maximumFractionDigits = options.maximumFractionDigits ?? (compact ? 1 : 2);
  // `Intl.NumberFormat` throws when the maximum sits below the minimum, so a
  // caller asking for whole dollars must not inherit the default minimum of 2.
  const minimumFractionDigits = Math.min(
    options.minimumFractionDigits ?? (compact ? 0 : 2),
    maximumFractionDigits,
  );
  return {
    currency: options.currency ?? DEFAULT_CURRENCY,
    locale: options.locale ?? DEFAULT_LOCALE,
    display: options.display ?? 'symbol',
    notation,
    minimumFractionDigits,
    maximumFractionDigits,
  };
};

const sanitizeNumber = (value: number): number => (Number.isFinite(value) ? value : 0);

/** Rounds to 2 decimals, absorbing the floating point drift of chained sums. */
export const roundToCents = (value: number): number => Math.round((sanitizeNumber(value) + Number.EPSILON) * 100) / 100;

export const formatCurrency = (value: number, options: CurrencyFormatOptions = {}): string =>
  getCurrencyFormatter(resolveCurrencyOptions(options)).format(roundToCents(value));

/** `12.4K` / `3.1M` — used by chart axes and dense KPI tiles. */
export const formatCurrencyCompact = (value: number, options: CurrencyFormatOptions = {}): string =>
  getCurrencyFormatter(resolveCurrencyOptions({ ...options, notation: 'compact' })).format(
    sanitizeNumber(value),
  );

export const formatNumber = (value: number, fractionDigits = 0, locale: string = DEFAULT_LOCALE): string =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(sanitizeNumber(value));

export const formatCompactNumber = (value: number, locale: string = DEFAULT_LOCALE): string =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    sanitizeNumber(value),
  );

export const formatPercent = (value: number, fractionDigits = 1): string =>
  `${sanitizeNumber(value).toFixed(fractionDigits)}%`;

/** Always carries an explicit `+`/`−` so trend arrows are never ambiguous. */
export const formatSignedPercent = (value: number, fractionDigits = 1): string => {
  const safe = sanitizeNumber(value);
  const sign = safe > 0 ? '+' : safe < 0 ? '−' : '';
  return `${sign}${Math.abs(safe).toFixed(fractionDigits)}%`;
};

/** `((revenue - profit) / revenue) * 100`, guarded against a zero denominator. */
export const calculateMarginPct = (profit: number, revenue: number): number => {
  const safeRevenue = sanitizeNumber(revenue);
  if (safeRevenue === 0) return 0;
  return roundToCents(((sanitizeNumber(profit) / safeRevenue) * 100));
};

/**
 * Period-over-period growth. A zero baseline has no meaningful percentage, so
 * the UI receives `0` and renders a neutral "no data" trend instead of `Infinity`.
 */
export const calculateGrowthPct = (current: number, previous: number): number => {
  const baseline = sanitizeNumber(previous);
  if (baseline === 0) return 0;
  return roundToCents(((sanitizeNumber(current) - baseline) / Math.abs(baseline)) * 100);
};

/** Sum helper that keeps 2-decimal precision across many additions. */
export const sumCurrency = (values: readonly number[]): number =>
  roundToCents(values.reduce<number>((total, value) => total + sanitizeNumber(value), 0));

/**
 * Parses user input from money fields: accepts `1,234.56`, `$1,234.56`, and
 * tolerates an empty or malformed field by returning `null` for the form layer
 * to translate into a validation error.
 */
export const parseCurrencyInput = (raw: string): number | null => {
  const normalized = raw.replace(/[^0-9.-]/g, '');
  if (normalized.trim() === '' || normalized === '-' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundToCents(parsed) : null;
};

/** Prefill value for an editable money input: plain digits, no symbol or grouping. */
export const toCurrencyInputValue = (value: number): string => sanitizeNumber(value).toFixed(2);
