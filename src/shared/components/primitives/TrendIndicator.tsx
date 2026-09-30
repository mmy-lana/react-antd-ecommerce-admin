/**
 * Trend micro-indicator.
 *
 * A number alone cannot say whether a rise is good news, so the indicator takes
 * an explicit `positiveIsGood` flag: revenue going up is good, an out-of-stock
 * count going up is not. Direction, arrow and colour are all derived from that
 * single decision so they can never disagree with each other.
 */

import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons';
import { Tooltip, Typography } from 'antd';
import type { CSSProperties, FC } from 'react';

import { colorTokens, statusToneColors } from '../../../app/theme/tokens';
import { formatSignedPercent } from '../../utils/currency';

export type TrendDirection = 'up' | 'down' | 'flat';

export const resolveTrendDirection = (value: number): TrendDirection => {
  if (!Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
};

export interface TrendIndicatorProps {
  /** Signed percentage. Sign drives the arrow; magnitude drives the label. */
  value: number;
  /**
   * Whether an increase is a positive result. Defaults to `true`; set `false`
   * for metrics such as out-of-stock counts where growth is a warning.
   */
  positiveIsGood?: boolean;
  /** Rendered after the percentage in a muted weight, e.g. `vs last 30 days`. */
  comparisonLabel?: string;
  /** Tooltip copy. Pass `null` to render without a tooltip at all. */
  tooltip?: string | null;
  size?: 'small' | 'default';
  /** Hides the arrow icon and renders the value as plain text. */
  plain?: boolean;
}

const resolveTone = (direction: TrendDirection, positiveIsGood: boolean): 'success' | 'danger' | 'neutral' => {
  if (direction === 'flat') return 'neutral';
  const isPositiveOutcome = direction === 'up' ? positiveIsGood : !positiveIsGood;
  return isPositiveOutcome ? 'success' : 'danger';
};

export const TrendIndicator: FC<TrendIndicatorProps> = ({
  value,
  positiveIsGood = true,
  comparisonLabel,
  tooltip,
  size = 'default',
  plain = false,
}) => {
  const direction = resolveTrendDirection(value);
  const tone = statusToneColors[resolveTone(direction, positiveIsGood)];
  const formatted = formatSignedPercent(value);

  const Icon =
    direction === 'up' ? ArrowUpOutlined : direction === 'down' ? ArrowDownOutlined : MinusOutlined;

  const spokenLabel = comparisonLabel ? `${formatted} ${comparisonLabel}` : formatted;

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: size === 'small' ? 12 : 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: direction === 'flat' ? colorTokens.textSecondary : tone.text,
    whiteSpace: 'nowrap',
  };

  const content = (
    <Typography.Text className="trend-indicator" style={style} data-direction={direction}>
      {/* The arrow duplicates the sign already carried by the number. */}
      {plain ? null : <Icon aria-hidden="true" style={{ fontSize: size === 'small' ? 10 : 12 }} />}
      <span aria-hidden={comparisonLabel ? true : undefined}>{formatted}</span>
      {comparisonLabel ? (
        <span style={{ color: colorTokens.textTertiary, fontWeight: 400 }}>{comparisonLabel}</span>
      ) : null}
      {/* Single announcement for the whole indicator, including comparison text. */}
      <span className="visually-hidden">{spokenLabel}</span>
    </Typography.Text>
  );

  if (tooltip === null) return content;

  return (
    <Tooltip title={tooltip ?? 'No comparable data for the preceding period'} placement="top">
      {content}
    </Tooltip>
  );
};

export default TrendIndicator;
