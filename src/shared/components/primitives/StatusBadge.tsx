/**
 * Status badge (plan Task 2.3).
 *
 * Resolves an inventory or order status to a labelled, colour-coded pill.
 *
 * Accessibility notes:
 *  - the dot is `aria-hidden`, because the label already carries the meaning and
 *    colour is never the sole indicator (WCAG 1.4.1);
 *  - the accessible name is `"<kind>: <label>"`, so the visible label is a
 *    substring of the accessible name (WCAG 2.5.3 Label in Name) — a screen
 *    reader user can search for the text they can see;
 *  - when the badge is used as a filter trigger it renders as a real `<button>`
 *    with the plan's 44px minimum touch target rather than a clickable `<span>`.
 */

import { Badge } from 'antd';
import type { CSSProperties, FC } from 'react';

import {
  colorTokens,
  fontTokens,
  statusToneColors,
  type StatusToneColors,
} from '../../../app/theme/tokens';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  STOCK_STATUS_LABEL,
  STOCK_STATUS_TONE,
  type BadgeTone,
  type OrderStatus,
  type StockStatus,
} from '../../types';
import { useTouchTargetStyle } from './ResponsiveContainer';

export type StatusDomain = 'stock' | 'order';

const DOMAIN_LABEL: Record<StatusDomain, string> = {
  stock: 'Stock status',
  order: 'Order status',
};

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  colors: StatusToneColors;
}

export const resolveStatusPresentation = (
  domain: StatusDomain,
  status: StockStatus | OrderStatus,
): StatusPresentation => {
  const tone = domain === 'stock' ? STOCK_STATUS_TONE[status as StockStatus] : ORDER_STATUS_TONE[status as OrderStatus];
  const label =
    domain === 'stock' ? STOCK_STATUS_LABEL[status as StockStatus] : ORDER_STATUS_LABEL[status as OrderStatus];

  return { label, tone, colors: statusToneColors[tone] };
};

interface StatusBadgeBaseProps {
  size?: 'small' | 'default';
  /** Shows the leading status dot. Defaults to `true`. */
  showDot?: boolean;
  /** Renders an Ant Design count bubble, e.g. the number of matching rows. */
  count?: number;
  className?: string;
  style?: CSSProperties;
}

export type StatusBadgeProps = StatusBadgeBaseProps &
  (
    | { domain: 'stock'; status: StockStatus; onClick?: () => void }
    | { domain: 'order'; status: OrderStatus; onClick?: () => void }
  );

export const StatusBadge: FC<StatusBadgeProps> = ({
  domain,
  status,
  size = 'default',
  showDot = true,
  count,
  className,
  style,
  onClick,
}) => {
  const { label, colors } = resolveStatusPresentation(domain, status);
  const { style: touchStyle } = useTouchTargetStyle();
  const compact = size === 'small';

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    paddingInline: compact ? 8 : 10,
    paddingBlock: compact ? 2 : 4,
    borderRadius: 999,
    fontSize: compact ? fontTokens.fontSizeTiny : fontTokens.fontSizeSmall,
    fontWeight: 600,
    lineHeight: compact ? '18px' : '22px',
    // The pill is sized explicitly rather than derived from its line box. A
    // flex parent with `align-items: stretch` — a table row, a list item — used
    // to stretch a badge whose only height came from `line-height` + padding
    // into a tall vertical sausage. `boxSizing: border-box` keeps the border
    // inside the declared height, and `alignSelf: center` stops the stretch
    // from reaching the pill at all.
    height: compact ? 22 : 26,
    boxSizing: 'border-box',
    alignSelf: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.text,
  };

  // Read-only badges are capped outright. The interactive variant is not: a
  // trigger has to keep its 44px touch target, and a `max-height` on a pill
  // whose `min-height` is 44 is a rule that silently loses. It still opts out
  // of stretching, so the row-height bug cannot come back through the button.
  const readOnlySize: CSSProperties = { maxHeight: compact ? 22 : 26 };

  const content = (
    <>
      {showDot ? (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: colors.solid,
            flexShrink: 0,
          }}
        />
      ) : null}
      <span>{label}</span>
    </>
  );

  const accessibleName = `${DOMAIN_LABEL[domain]}: ${label}`;

  const pill = onClick ? (
    <button
      type="button"
      className="status-badge status-badge--interactive"
      aria-label={accessibleName}
      onClick={onClick}
      style={{
        ...pillStyle,
        ...touchStyle,
        ...style,
        cursor: 'pointer',
        fontFamily: fontTokens.fontFamily,
      }}
    >
      {content}
    </button>
  ) : (
    <span
      className={['status-badge', className].filter(Boolean).join(' ')}
      aria-label={accessibleName}
      style={{ ...pillStyle, ...readOnlySize, ...style }}
    >
      {content}
    </span>
  );

  if (count === undefined) return pill;

  return (
    <Badge count={count} overflowCount={999} offset={[8, -2]} color={colorTokens.primary}>
      {pill}
    </Badge>
  );
};

export default StatusBadge;
