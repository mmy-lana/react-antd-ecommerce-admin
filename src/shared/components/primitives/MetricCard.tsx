/**
 * KPI metric card (plan Task 2.2).
 *
 * Displays a formatted metric value, an optional trend micro-indicator and a
 * secondary comparison label. The card is the app's primary scan target, so the
 * value renders with tabular figures (prevents the number jittering as it
 * updates) and the whole card is announced as a single labelled region rather
 * than three unrelated fragments.
 */

import { Card, Skeleton, Typography } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens, statusToneColors } from '../../../app/theme/tokens';
import { TrendIndicator } from './TrendIndicator';

export type MetricAccent = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export interface MetricCardProps {
  /** Label for the metric, e.g. `Total Revenue`. */
  title: string;
  /** Pre-formatted value. Formatting stays with the caller so units are explicit. */
  value: ReactNode;
  /** Optional leading glyph. Decorative by default. */
  icon?: ReactNode;
  /** Signed percentage change rendered as the trend indicator. */
  trend?: number;
  /**
   * Whether a rising trend is good. Defaults to `true`; pass `false` for
   * inventory alerts such as out-of-stock counts.
   */
  positiveIsGood?: boolean;
  /** Comparison text next to the trend, e.g. `vs prev 30 days`. */
  trendComparisonLabel?: string;
  /** Tooltip for the trend indicator. Pass `null` to hide the tooltip. */
  trendTooltip?: string | null;
  /** Secondary line under the value, e.g. `1,204 units`. */
  secondaryLabel?: ReactNode;
  /** Tertiary footnote line. */
  hint?: ReactNode;
  /** Drives the left rail and the icon chip colour. */
  accent?: MetricAccent;
  /** Renders a skeleton instead of the value while data resolves. */
  loading?: boolean;
  /** Tighter padding and type scale for dense grids. */
  size?: 'default' | 'compact';
  /** Makes the card activatable; requires an accessible name. */
  onClick?: () => void;
  /**
   * Appended to the card's accessible name. Metric values are formatted for
   * scanning, not for listening, so a spoken sentence belongs here.
   */
  ariaDescription?: string;
}

const ACCENT_COLOR: Record<MetricAccent, string> = {
  primary: colorTokens.primary,
  success: statusToneColors.success.solid,
  warning: statusToneColors.warning.solid,
  danger: statusToneColors.danger.solid,
  info: statusToneColors.info.solid,
  neutral: colorTokens.textTertiary,
};

export const MetricCard: FC<MetricCardProps> = ({
  title,
  value,
  icon,
  trend,
  positiveIsGood = true,
  trendComparisonLabel,
  trendTooltip,
  secondaryLabel,
  hint,
  accent = 'primary',
  loading = false,
  size = 'default',
  onClick,
  ariaDescription,
}) => {
  const compact = size === 'compact';
  const accentColor = ACCENT_COLOR[accent];

  const rootStyle: CSSProperties = {
    position: 'relative',
    height: '100%',
    minHeight: compact ? 104 : layoutTokens.metricCardMinHeight,
    borderColor: colorTokens.borderColor,
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1), border-color 200ms',
  };

  const bodyStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? 6 : 10,
    height: '100%',
    padding: compact ? layoutTokens.contentPaddingCompact : layoutTokens.contentPadding,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  };

  const valueStyle: CSSProperties = {
    fontSize: compact ? 22 : 30,
    fontWeight: 700,
    lineHeight: 1.2,
    color: colorTokens.textPrimary,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    overflowWrap: 'anywhere',
  };

  const hasTrend = trend !== undefined && Number.isFinite(trend);

  const baseName = onClick ? `${title} — open details` : title;
  const accessibleName = ariaDescription ? `${baseName}. ${ariaDescription}` : baseName;

  const cardContent = (
    <>
      {/* Accent rail — decorative, the value carries the meaning. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: 0,
          width: 3,
          background: accentColor,
        }}
      />

      <div style={bodyStyle}>
        <div style={headerStyle}>
          {icon ? (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: compact ? 24 : 30,
                height: compact ? 24 : 30,
                borderRadius: 8,
                background: `${accentColor}1a`,
                color: accentColor,
                fontSize: compact ? 13 : 16,
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
          ) : null}

          <Typography.Text
            style={{
              color: colorTokens.textSecondary,
              fontSize: compact ? fontTokens.fontSizeSmall : fontTokens.fontSizeBase,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </Typography.Text>
        </div>

        {loading ? (
          <Skeleton.Input
            active
            size="small"
            style={{ width: compact ? 96 : 140, marginTop: 4 }}
            aria-label={`Loading ${title}`}
          />
        ) : (
          <div style={valueStyle} data-testid={`metric-value-${title}`}>
            {value}
          </div>
        )}

        {hasTrend || secondaryLabel || hint ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: compact ? 6 : 10,
              marginTop: 'auto',
            }}
          >
            {hasTrend && !loading ? (
              <TrendIndicator
                value={trend}
                positiveIsGood={positiveIsGood}
                comparisonLabel={trendComparisonLabel}
                tooltip={trendTooltip}
                size={compact ? 'small' : 'default'}
              />
            ) : null}

            {secondaryLabel ? (
              <Typography.Text
                style={{
                  color: colorTokens.textSecondary,
                  fontSize: fontTokens.fontSizeSmall,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {secondaryLabel}
              </Typography.Text>
            ) : null}

            {hint ? (
              <Typography.Text
                style={{
                  color: colorTokens.textTertiary,
                  fontSize: fontTokens.fontSizeTiny,
                  marginInlineStart: 'auto',
                }}
              >
                {hint}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <Card
      className="metric-card"
      variant="outlined"
      style={rootStyle}
      styles={{ body: { padding: 0 } }}
      role={onClick ? 'button' : 'group'}
      tabIndex={onClick ? 0 : undefined}
      aria-label={accessibleName}
      aria-busy={loading || undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {cardContent}
    </Card>
  );
};

export default MetricCard;
