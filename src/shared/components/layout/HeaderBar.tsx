/**
 * Application header (plan Task 5.1).
 *
 * On mobile the header owns the only way to open navigation, so its menu button
 * is the first focusable element on the page and carries an explicit accessible
 * name. On desktop it holds the page title, a live clock and a workspace badge
 * instead, because navigation is already permanently visible.
 *
 * The header content is exported as {@link HeaderBarBody} so the suite can assert
 * it without mounting the sticky wrapper.
 */

import { Badge, Button, Tooltip, Typography } from 'antd';
import { MenuOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { type FC } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { APP_TITLE, ROUTE_TITLES, type RoutePath } from '../../../app/Router';
import { useIsMobile } from '../primitives/ResponsiveContainer';
import { navTargetStyle } from './SidebarNav';

dayjs.extend(utc);

/** UTC, because every stored timestamp is UTC and the console says so. */
export const formatUtcClock = (iso: string): string => dayjs.utc(iso).format('MMM D, YYYY HH:mm') + ' UTC';

export interface HeaderBarBodyProps {
  currentRoute: RoutePath;
  /** Renders the menu button; hidden on desktop where the sidebar is fixed. */
  onOpenNavigation?: () => void;
  /** Live workspace counts, e.g. `{ products: 30, alerts: 7 }`. */
  summary?: { products: number; alerts: number } | null;
  /** Rendered after the title, e.g. a date-range picker. */
  children?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const HeaderBarBody: FC<HeaderBarBodyProps> = ({
  currentRoute,
  onOpenNavigation,
  summary = null,
  children,
  onRefresh,
  refreshing = false,
}) => {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: layoutTokens.gridGutter,
        width: '100%',
        minWidth: 0,
      }}
    >
      {isMobile && onOpenNavigation !== undefined ? (
        <Button
          type="text"
          icon={<MenuOutlined />}
          onClick={onOpenNavigation}
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-expanded={false}
          style={{ ...navTargetStyle, color: colorTokens.textPrimary, flexShrink: 0 }}
        />
      ) : null}

      <div style={{ minWidth: 0, flexShrink: 1 }}>
        <Typography.Text
          strong
          style={{
            color: colorTokens.textPrimary,
            fontSize: isMobile ? fontTokens.fontSizeBase : fontTokens.fontSizeHeading3,
            display: 'block',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {ROUTE_TITLES[currentRoute]}
        </Typography.Text>
        <Typography.Text
          style={{
            color: colorTokens.textTertiary,
            fontSize: fontTokens.fontSizeSmall,
            display: 'block',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {APP_TITLE}
        </Typography.Text>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {children}

        {!isMobile && (
          <Typography.Text
            style={{
              color: colorTokens.textTertiary,
              fontSize: fontTokens.fontSizeSmall,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              marginRight: 8,
            }}
            aria-label="Current UTC timestamp"
          >
            {formatUtcClock(new Date().toISOString())}
          </Typography.Text>
        )}

        {summary === null ? null : (
          <Tooltip title={`${summary.alerts} product${summary.alerts === 1 ? '' : 's'} at or below the safety line`}>
            <Badge
              count={summary.alerts}
              overflowCount={99}
              style={{ backgroundColor: summary.alerts > 0 ? colorTokens.warning : colorTokens.success }}
            >
              <Typography.Text
                style={{
                  color: colorTokens.textSecondary,
                  fontSize: fontTokens.fontSizeSmall,
                  whiteSpace: 'nowrap',
                }}
              >
                {summary.products} products
              </Typography.Text>
            </Badge>
          </Tooltip>
        )}

        {onRefresh === undefined ? null : (
          <Button
            type="text"
            icon={<ReloadOutlined spin={refreshing} />}
            onClick={onRefresh}
            aria-label="Refresh workspace data"
            loading={refreshing}
            style={{ ...navTargetStyle, color: colorTokens.textSecondary }}
          />
        )}
      </div>
    </div>
  );
};

export interface HeaderBarProps extends HeaderBarBodyProps {
  /** Sticky offset from the top, in pixels. */
  stickyTop?: number;
}

/**
 * The sticky header chrome.
 *
 * `position: sticky` rather than `fixed`, so the header participates in layout
 * and the content column below it is not overlapped.
 */
export const HeaderBar: FC<HeaderBarProps> = ({ stickyTop = 0, ...body }) => (
  <header
    style={{
      position: 'sticky',
      top: stickyTop,
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      gap: layoutTokens.gridGutter,
      minHeight: layoutTokens.headerHeight,
      padding: `0 ${layoutTokens.contentPadding}px`,
      background: colorTokens.cardBackground,
      borderBottom: `1px solid ${colorTokens.borderColor}`,
      boxSizing: 'border-box',
    }}
  >
    <HeaderBarBody {...body} />
  </header>
);

export default HeaderBar;
