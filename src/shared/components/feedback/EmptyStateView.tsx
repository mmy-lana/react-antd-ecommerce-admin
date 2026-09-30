/**
 * Empty and zero-result state (plan Task 2.5).
 *
 * Every list, table and chart in this app routes its "nothing to show" case
 * through this component so the copy, spacing and recovery affordance stay
 * consistent. Two variants are distinguished:
 *
 *  - `filtered` — records exist but the active filters exclude all of them. The
 *    recovery action clears filters.
 *  - `empty` — there is genuinely nothing in the store yet.
 */

import { Button, Space, Typography } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';

export type EmptyStateVariant = 'empty' | 'filtered' | 'error' | 'search';

export interface EmptyStateViewProps {
  title: string;
  /** Explains why the state occurred and, for `filtered`, what to do about it. */
  description?: ReactNode;
  /** Decorative glyph. Hidden from assistive technology. */
  icon?: ReactNode;
  /** Primary recovery action, e.g. `Clear filters`. */
  action?: ReactNode;
  /** Secondary action, e.g. `Create product`. */
  secondaryAction?: ReactNode;
  variant?: EmptyStateVariant;
  size?: 'small' | 'default' | 'large';
  /** Draws a dashed frame so the state reads as a placeholder region. */
  bordered?: boolean;
  className?: string;
  style?: CSSProperties;
}

const SIZE_SCALE: Record<
  NonNullable<EmptyStateViewProps['size']>,
  { padding: number; icon: number; title: number; gap: number }
> = {
  small: { padding: 20, icon: 28, title: fontTokens.fontSizeBase, gap: 6 },
  default: { padding: 36, icon: 40, title: fontTokens.fontSizeHeading4, gap: 10 },
  large: { padding: 56, icon: 56, title: fontTokens.fontSizeHeading3, gap: 14 },
};

export const EmptyStateView: FC<EmptyStateViewProps> = ({
  title,
  description,
  icon,
  action,
  secondaryAction,
  variant = 'empty',
  size = 'default',
  bordered = true,
  className,
  style,
}) => {
  const scale = SIZE_SCALE[size];

  const hasActions = Boolean(action) || Boolean(secondaryAction);

  const rootStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: scale.gap,
    padding: scale.padding,
    minHeight: '100%',
    borderRadius: 12,
    border: bordered ? `1px dashed ${colorTokens.borderColorStrong}` : 'none',
    background: bordered ? colorTokens.backgroundCanvas : 'transparent',
    ...style,
  };

  return (
    <div
      className={['empty-state-view', className].filter(Boolean).join(' ')}
      data-variant={variant}
      style={rootStyle}
    >
      {icon ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: scale.icon + 24,
            height: scale.icon + 24,
            borderRadius: '50%',
            background: colorTokens.backgroundSubtle,
            color: colorTokens.textTertiary,
            fontSize: scale.icon,
          }}
        >
          {icon}
        </span>
      ) : null}

      <Typography.Title
        level={5}
        style={{
          margin: 0,
          fontSize: scale.title,
          fontWeight: 600,
          color: colorTokens.textPrimary,
        }}
      >
        {title}
      </Typography.Title>

      {description ? (
        <Typography.Paragraph
          style={{
            margin: 0,
            maxWidth: 460,
            color: colorTokens.textSecondary,
            fontSize: fontTokens.fontSizeBase,
          }}
        >
          {description}
        </Typography.Paragraph>
      ) : null}

      {hasActions ? (
        <Space
          size={layoutTokens.gridGutter / 2}
          wrap
          style={{ marginTop: 8, justifyContent: 'center' }}
        >
          {action}
          {secondaryAction}
        </Space>
      ) : null}
    </div>
  );
};

/** Convenience wrapper for the "filters excluded everything" case. */
export const FilteredEmptyState: FC<{
  description?: string;
  onClearFilters: () => void;
  clearing?: boolean;
}> = ({ description, onClearFilters, clearing = false }) => (
  <EmptyStateView
    variant="filtered"
    title="No records match these filters"
    description={
      description ??
      'Every record in this workspace exists, but none of them satisfy the current filters. Widen the date range or clear the filters to see results.'
    }
    action={
      <Button type="primary" onClick={onClearFilters} loading={clearing}
        style={{ minHeight: layoutTokens.touchTargetMinSize }}>
        Clear all filters
      </Button>
    }
  />
);

export default EmptyStateView;
