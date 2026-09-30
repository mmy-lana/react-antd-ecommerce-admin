/**
 * Design tokens.
 *
 * Single source of truth for the palette, layout metrics and chart colors.
 * `themeConfig.ts` maps these onto Ant Design's token tree and the chart
 * components read them directly, so one palette edit propagates to components,
 * charts and CSS custom properties together.
 *
 * The neutral ramp is the Tailwind `slate` scale: it is perceptually even, so
 * `slate-500` text on `slate-50` canvas holds a 4.6:1 contrast ratio and
 * `slate-400` on `slate-900` holds 7.1:1 for the dark sidebar.
 */

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

export const palette = {
  white: '#ffffff',

  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',
  slate950: '#020617',

  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue500: '#3b82f6',
  blue600: '#2563eb',
  blue700: '#1d4ed8',

  emerald50: '#ecfdf5',
  emerald100: '#d1fae5',
  emerald500: '#10b981',
  emerald600: '#059669',
  emerald700: '#047857',

  amber50: '#fffbeb',
  amber100: '#fef3c7',
  amber500: '#f59e0b',
  amber600: '#d97706',
  amber700: '#b45309',

  rose50: '#fff1f2',
  rose100: '#ffe4e6',
  rose500: '#f43f5e',
  rose600: '#e11d48',
  rose700: '#be123c',

  red50: '#fef2f2',
  red100: '#fee2e2',
  red500: '#ef4444',
  red600: '#dc2626',
  red700: '#b91c1c',

  violet500: '#8b5cf6',
  violet600: '#7c3aed',
  cyan500: '#06b6d4',
  cyan600: '#0891b2',
  teal500: '#14b8a6',
  pink500: '#ec4899',
  indigo500: '#6366f1',
} as const;

/* -------------------------------------------------------------------------- */
/* Semantic color tokens                                                        */
/* -------------------------------------------------------------------------- */

export const colorTokens = {
  /** Primary brand — action blue. */
  primary: palette.blue600,
  primaryHover: palette.blue500,
  primaryPressed: palette.blue700,
  primarySurface: palette.blue50,
  primaryBorder: palette.blue100,

  success: palette.emerald500,
  successSurface: palette.emerald50,
  warning: palette.amber500,
  warningSurface: palette.amber50,
  error: palette.red500,
  errorSurface: palette.red50,
  info: palette.blue500,
  infoSurface: palette.blue50,

  /** Dark navigation rail. */
  neutralDark: palette.slate900,
  neutralDarker: palette.slate950,
  neutralDarkRaised: palette.slate800,
  neutralDarkBorder: palette.slate800,
  neutralDarkText: palette.slate300,
  neutralDarkTextActive: palette.white,
  neutralDarkTextMuted: palette.slate400,
  neutralDarkItemSelected: '#1d4ed8',

  /** Light application surfaces. */
  backgroundCanvas: palette.slate50,
  backgroundSubtle: palette.slate100,
  cardBackground: palette.white,
  tableHeaderBackground: palette.slate100,
  borderColor: palette.slate200,
  borderColorStrong: palette.slate300,

  textPrimary: palette.slate900,
  textSecondary: palette.slate500,
  textTertiary: palette.slate400,
  textInverse: palette.white,
} as const;

/* -------------------------------------------------------------------------- */
/* Status badge palette                                                         */
/* -------------------------------------------------------------------------- */

export interface StatusToneColors {
  /** Badge background. */
  surface: string;
  /** Border ring. */
  border: string;
  /** Foreground text — each pair is verified at >= 4.5:1 on its surface. */
  text: string;
  /** Solid fill used for dots and chart keys. */
  solid: string;
}

/** Semantic badge fills keyed by the shared `BadgeTone` union. */
export const statusToneColors: Record<'success' | 'warning' | 'danger' | 'info' | 'neutral', StatusToneColors> = {
  success: {
    surface: palette.emerald50,
    border: palette.emerald100,
    text: palette.emerald700,
    solid: palette.emerald500,
  },
  warning: {
    surface: palette.amber50,
    border: palette.amber100,
    text: palette.amber700,
    solid: palette.amber500,
  },
  danger: {
    surface: palette.red50,
    border: palette.red100,
    text: palette.red700,
    solid: palette.red500,
  },
  info: {
    surface: palette.blue50,
    border: palette.blue100,
    text: palette.blue700,
    solid: palette.blue500,
  },
  neutral: {
    surface: palette.slate100,
    border: palette.slate200,
    text: palette.slate700,
    solid: palette.slate500,
  },
};

/* -------------------------------------------------------------------------- */
/* Chart palette                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Categorical series for `@ant-design/plots`. Hues are spaced far enough apart
 * to stay distinguishable under the common forms of color vision deficiency, and
 * the first entry always matches `colorTokens.primary` so the revenue series
 * and the brand agree.
 */
export const chartPalette = [
  palette.blue600,
  palette.emerald500,
  palette.amber500,
  palette.violet500,
  palette.cyan500,
  palette.rose500,
  palette.teal500,
  palette.indigo500,
  palette.pink500,
] as const;

export const chartTokens = {
  /** Revenue area/line. */
  revenue: palette.blue600,
  /** Net profit series, overlaid on the revenue chart. */
  profit: palette.emerald500,
  /** Order-count series when a chart switches to a count axis. */
  orders: palette.violet500,
  /** Filled area gradient stops, top to bottom. */
  revenueGradient: [palette.blue500, palette.blue600],
  gridLine: palette.slate200,
  axisLabel: palette.slate500,
  axisTitle: palette.slate600,
  donutCenterLabel: palette.slate900,
  donutCenterCaption: palette.slate500,
} as const;

/* -------------------------------------------------------------------------- */
/* Layout + motion                                                              */
/* -------------------------------------------------------------------------- */

export const layoutTokens = {
  headerHeight: 64,
  sidebarWidth: 240,
  sidebarCollapsedWidth: 80,
  mobileBreakpoint: 768,
  compactBreakpoint: 480,
  /** WCAG 2.5.8 target size, and the plan's hard floor for table actions. */
  touchTargetMinSize: 44,
  /** Base width for every drawer/dialog overlay. */
  drawerWidth: 460,
  wideDrawerWidth: 720,
  contentMaxWidth: 1680,
  contentPadding: 24,
  contentPaddingCompact: 12,
  gridGutter: 16,
  tableRowHeight: 52,
  metricCardMinHeight: 132,
} as const;

export const motionTokens = {
  /** Fast enough to feel instant, slow enough to read as motion. */
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/* -------------------------------------------------------------------------- */
/* Typography                                                                   */
/* -------------------------------------------------------------------------- */

export const fontTokens = {
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** Tabular figures keep currency columns from shifting as digits change. */
  numericFontFamily:
    "'Inter', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  /** Design token values mirror the Ant Design `fontSize` ramp. */
  fontSizeTiny: 12,
  fontSizeSmall: 14,
  fontSizeBase: 14,
  fontSizeHeading4: 16,
  fontSizeHeading3: 20,
  fontSizeHeading2: 24,
  fontSizeHeading1: 30,
  lineHeightBase: 1.5715,
} as const;
