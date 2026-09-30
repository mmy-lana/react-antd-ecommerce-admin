/**
 * Ant Design theme configuration.
 *
 * Maps the design tokens onto Ant Design's token tree. The theme is static by
 * design: this console is a single light-mode analytics surface, so a dynamic
 * theme provider would add a re-render path for no user-visible benefit.
 *
 * Ant Design 6 note: component token names that were flattened into the global
 * `color*` ramp in v5 (e.g. `Table.headerBg` → `colorFillAlter`) are still
 * accepted here, so each component is configured through the override that
 * actually exists rather than through a removed alias.
 */

import type { ThemeConfig } from 'antd';

import { chartPalette, chartTokens, colorTokens, fontTokens, layoutTokens, motionTokens } from './tokens';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: colorTokens.primary,
    colorPrimaryHover: colorTokens.primaryHover,
    colorPrimaryBg: colorTokens.primarySurface,
    colorPrimaryBorder: colorTokens.primaryBorder,

    colorSuccess: colorTokens.success,
    colorSuccessBg: colorTokens.successSurface,
    colorWarning: colorTokens.warning,
    colorWarningBg: colorTokens.warningSurface,
    colorError: colorTokens.error,
    colorErrorBg: colorTokens.errorSurface,
    colorInfo: colorTokens.info,
    colorInfoBg: colorTokens.infoSurface,

    colorTextBase: colorTokens.textPrimary,
    colorBgBase: colorTokens.cardBackground,
    colorBgLayout: colorTokens.backgroundCanvas,
    colorBgContainer: colorTokens.cardBackground,
    colorBgElevated: colorTokens.cardBackground,
    colorFillAlter: colorTokens.backgroundSubtle,
    colorBorder: colorTokens.borderColor,
    colorBorderSecondary: colorTokens.borderColor,

    fontFamily: fontTokens.fontFamily,
    fontSize: fontTokens.fontSizeBase,
    fontSizeSM: fontTokens.fontSizeSmall,
    fontSizeLG: fontTokens.fontSizeHeading4,
    fontSizeHeading1: fontTokens.fontSizeHeading1,
    fontSizeHeading2: fontTokens.fontSizeHeading2,
    fontSizeHeading3: fontTokens.fontSizeHeading3,
    fontSizeHeading4: fontTokens.fontSizeHeading4,
    lineHeight: fontTokens.lineHeightBase,

    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    controlHeight: 36,
    controlHeightLG: 40,
    controlHeightSM: 32,

    motionDurationFast: motionTokens.fast,
    motionDurationMid: motionTokens.base,
    motionDurationSlow: motionTokens.slow,
    motionEaseInOut: motionTokens.easing,
  },

  components: {
    Layout: {
      bodyBg: colorTokens.backgroundCanvas,
      headerBg: colorTokens.cardBackground,
      headerHeight: layoutTokens.headerHeight,
      headerPadding: `0 ${layoutTokens.contentPadding}px`,
      siderBg: colorTokens.neutralDark,
      triggerBg: colorTokens.neutralDarker,
      footerBg: colorTokens.backgroundCanvas,
      footerPadding: `${layoutTokens.contentPadding}px`,
    },

    Menu: {
      darkItemBg: colorTokens.neutralDark,
      darkSubMenuItemBg: colorTokens.neutralDark,
      darkPopupBg: colorTokens.neutralDarkRaised,
      darkItemColor: colorTokens.neutralDarkText,
      darkItemHoverColor: colorTokens.neutralDarkTextActive,
      darkItemHoverBg: colorTokens.neutralDarkRaised,
      darkItemSelectedBg: colorTokens.neutralDarkItemSelected,
      darkItemSelectedColor: colorTokens.neutralDarkTextActive,
      darkGroupTitleColor: colorTokens.neutralDarkTextMuted,
      itemHeight: 44,
      itemMarginInline: 12,
      itemBorderRadius: 8,
      iconSize: 16,
      collapsedWidth: layoutTokens.sidebarCollapsedWidth,
    },

    Card: {
      colorBgContainer: colorTokens.cardBackground,
      colorBorderSecondary: colorTokens.borderColor,
      headerBg: 'transparent',
      headerFontSize: fontTokens.fontSizeHeading4,
      headerHeight: 52,
      bodyPadding: layoutTokens.contentPadding,
      paddingLG: layoutTokens.contentPadding,
    },

    Table: {
      headerBg: colorTokens.tableHeaderBackground,
      headerColor: colorTokens.textSecondary,
      headerSplitColor: colorTokens.cardBackground,
      headerBorderRadius: 8,
      borderColor: colorTokens.borderColor,
      bodySortBg: colorTokens.primarySurface,
      rowHoverBg: colorTokens.backgroundCanvas,
      rowSelectedBg: colorTokens.primarySurface,
      rowSelectedHoverBg: colorTokens.primaryBorder,
      rowExpandedBg: colorTokens.backgroundCanvas,
      footerBg: colorTokens.backgroundSubtle,
      footerColor: colorTokens.textSecondary,
      cellPaddingBlock: 12,
      cellPaddingInline: 12,
      cellFontSize: fontTokens.fontSizeBase,
      expandIconBg: colorTokens.textTertiary,
      selectionColumnWidth: 48,
      stickyScrollBarBorderRadius: 999,
    },

    Button: {
      borderRadius: 8,
      controlHeight: 36,
      controlHeightLG: 40,
      controlHeightSM: 32,
      fontSize: fontTokens.fontSizeBase,
      contentFontSize: fontTokens.fontSizeBase,
      fontWeight: 500,
      paddingInline: 16,
      primaryShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
      defaultShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      dangerShadow: 'none',
      defaultBg: colorTokens.cardBackground,
      defaultBorderColor: colorTokens.borderColorStrong,
      defaultColor: colorTokens.textPrimary,
    },

    Drawer: {
      colorBgElevated: colorTokens.cardBackground,
      paddingLG: layoutTokens.contentPadding,
      paddingMD: 16,
      paddingSM: 12,
      footerPaddingBlock: 12,
      footerPaddingInline: layoutTokens.contentPadding,
    },

    Modal: {
      contentBg: colorTokens.cardBackground,
      headerBg: colorTokens.cardBackground,
      titleColor: colorTokens.textPrimary,
      titleFontSize: fontTokens.fontSizeHeading3,
      footerBg: colorTokens.cardBackground,
      borderRadiusLG: 12,
      paddingContentHorizontalLG: layoutTokens.contentPadding,
      paddingContentVerticalLG: 20,
    },

    Statistic: {
      titleFontSize: fontTokens.fontSizeSmall,
      contentFontSize: 28,
    },

    Badge: {
      textFontSize: fontTokens.fontSizeSmall,
      textFontWeight: 500,
      statusSize: 8,
      paddingInline: 8,
      colorError: colorTokens.error,
      colorSuccess: colorTokens.success,
      colorWarning: colorTokens.warning,
      colorInfo: colorTokens.info,
    },

    Tag: {
      defaultBg: colorTokens.backgroundSubtle,
      defaultColor: colorTokens.textSecondary,
      borderRadiusSM: 999,
    },

    Segmented: {
      itemSelectedBg: colorTokens.cardBackground,
      itemSelectedColor: colorTokens.textPrimary,
      trackBg: colorTokens.backgroundSubtle,
      trackPadding: 4,
    },

    Descriptions: {
      titleMarginBottom: 12,
      itemPaddingBottom: 12,
      labelBg: colorTokens.backgroundSubtle,
      labelColor: colorTokens.textSecondary,
      contentColor: colorTokens.textPrimary,
    },

    Empty: {
      colorTextDescription: colorTokens.textTertiary,
      fontSize: fontTokens.fontSizeBase,
    },

    Skeleton: {
      gradientFromColor: 'rgba(148, 163, 184, 0.16)',
      gradientToColor: 'rgba(148, 163, 184, 0.04)',
    },

    Alert: {
      borderRadius: 8,
      defaultPadding: 12,
      withDescriptionPadding: 16,
      withDescriptionIconSize: 18,
    },

    Input: {
      paddingBlock: 6,
      paddingInline: 12,
      activeShadow: `0 0 0 2px ${colorTokens.primaryBorder}`,
      hoverBorderColor: colorTokens.primary,
    },

    Select: {
      optionSelectedBg: colorTokens.primarySurface,
      optionSelectedColor: colorTokens.textPrimary,
      selectorBg: colorTokens.cardBackground,
    },

    DatePicker: {
      activeBorderColor: colorTokens.primary,
      cellActiveWithRangeBg: colorTokens.primarySurface,
      cellHoverBg: colorTokens.backgroundSubtle,
    },

    Tabs: {
      titleFontSize: fontTokens.fontSizeBase,
      inkBarColor: colorTokens.primary,
      horizontalItemPadding: `12px 0`,
      horizontalMargin: `0 0 16px 0`,
    },

    Progress: {
      defaultColor: colorTokens.primary,
      remainingColor: colorTokens.backgroundSubtle,
    },

    Tooltip: {
      colorBgSpotlight: colorTokens.neutralDark,
    },

    Divider: {
      colorSplit: colorTokens.borderColor,
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Chart theme                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * G2 (v5, the engine behind `@ant-design/plots` v2) theme object.
 *
 * Charts cannot read Ant Design's CSS variables from a canvas renderer, so the
 * same tokens are projected onto G2's own theme tree here.
 */
export const commerceChartTheme = {
  type: 'classify',
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: fontTokens.fontFamily,
    fontSize: fontTokens.fontSizeSmall,
    fill: chartTokens.axisLabel,
  },
  view: {
    viewFill: 'transparent',
    plotFill: 'transparent',
    mainFill: 'transparent',
    contentFill: 'transparent',
  },
  axis: {
    line: { stroke: chartTokens.gridLine, lineWidth: 1 },
    label: {
      fill: chartTokens.axisLabel,
      fontSize: fontTokens.fontSizeTiny,
      autoRotate: false,
      autoHide: true,
    },
    title: { fill: chartTokens.axisTitle, fontSize: fontTokens.fontSizeTiny },
    grid: { stroke: chartTokens.gridLine, lineWidth: 1, lineDash: [3, 3] },
    gridLineX: { stroke: 'transparent' },
  },
  legend: {
    color: {
      itemLabelFill: chartTokens.axisLabel,
      itemMarkerStroke: 'transparent',
    },
    title: { fill: chartTokens.axisTitle, fontSize: fontTokens.fontSizeTiny },
  },
  label: {
    fill: chartTokens.axisTitle,
    fontSize: fontTokens.fontSizeTiny,
  },
  intervalBarStyle: {
    radiusTopLeft: 4,
    radiusTopRight: 4,
  },
  line: {
    style: { lineWidth: 2 },
  },
  area: {
    style: { fillOpacity: 0.18 },
  },
  scale: {
    color: { range: [...chartPalette] },
  },
} as const;

/** Height presets keep every chart card the same size across the three views. */
export const chartSizeTokens = {
  timeSeriesHeight: 320,
  timeSeriesHeightCompact: 240,
  donutHeight: 320,
  donutHeightCompact: 260,
  minChartWidth: 0,
} as const;
