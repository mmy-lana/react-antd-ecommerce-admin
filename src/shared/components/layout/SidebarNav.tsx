/**
 * Sidebar navigation for the desktop shell (plan Task 5.1).
 *
 * Renders as a real `<nav>` holding a `<ul>` of buttons, so assistive technology
 * announces the item count and the list semantics survive. Collapsing swaps each
 * item to its icon alone; the accessible name is kept in `aria-label`, because
 * an icon-only control with no name is unusable.
 *
 * The list itself is exported as {@link NavItemList} so the mobile drawer renders
 * the identical items, and so the verification suite can assert it without a
 * portal.
 */

import { Typography } from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { type FC, type ReactElement } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { ROUTE_TITLES, type RoutePath } from '../../../app/Router';
import { useIsMobile } from '../primitives/ResponsiveContainer';

export interface NavItem {
  route: RoutePath;
  label: string;
  hint: string;
  icon: ReactElement;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { route: 'dashboard', label: 'Dashboard', hint: 'Revenue, margin and stock health', icon: <AppstoreOutlined /> },
  { route: 'inventory', label: 'Inventory', hint: 'Stock levels, adjustments, catalog', icon: <DatabaseOutlined /> },
  { route: 'sales', label: 'Sales', hint: 'Orders, fulfilment and refunds', icon: <ShoppingCartOutlined /> },
];

/**
 * The single source of truth for navigation touch targets.
 *
 * Every interactive element in the shell spreads this, so the sidebar, the
 * drawer and the header cannot drift, and the suite can assert all of them.
 */
export const navTargetStyle = {
  minHeight: layoutTokens.touchTargetMinSize,
  minWidth: layoutTokens.touchTargetMinSize,
} as const;

export interface NavItemListProps {
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
  collapsed?: boolean;
  /** Called after navigation so the mobile drawer can close itself. */
  onNavigateAndClose?: () => void;
}

export const NavItemList: FC<NavItemListProps> = ({
  currentRoute,
  onNavigate,
  collapsed = false,
  onNavigateAndClose,
}) => {
  const handleClick = (route: RoutePath): void => {
    onNavigate(route);
    onNavigateAndClose?.();
  };

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isCurrent = item.route === currentRoute;

        return (
          <li key={item.route} style={{ display: 'block' }}>
            <button
              type="button"
              id={`nav-${item.route}`}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={collapsed ? `${item.label} — ${item.hint}` : undefined}
              onClick={() => handleClick(item.route)}
              style={{
                ...navTargetStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: collapsed ? '0 16px' : '0 12px',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'left',
                background: isCurrent ? colorTokens.primarySurface : 'transparent',
                color: isCurrent ? colorTokens.primary : colorTokens.textSecondary,
                fontFamily: fontTokens.fontFamily,
                fontSize: fontTokens.fontSizeBase,
                fontWeight: isCurrent ? 600 : 400,
                overflow: 'hidden',
              }}
            >
              <span
                aria-hidden="true"
                style={{ display: 'inline-flex', fontSize: 18, flexShrink: 0, lineHeight: 1 }}
              >
                {item.icon}
              </span>
              {collapsed ? null : (
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                  <span
                    style={{
                      color: colorTokens.textTertiary,
                      fontSize: fontTokens.fontSizeSmall,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.hint}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export interface SidebarNavProps {
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
  collapsed?: boolean;
  ariaLabel?: string;
}

export const SidebarNav: FC<SidebarNavProps> = ({
  currentRoute,
  onNavigate,
  collapsed = false,
  ariaLabel = 'Primary',
}) => {
  // Below 768px the shell shows the slide-over drawer instead. Rendering both
  // would give the page two navigation landmarks carrying the same label.
  const isMobile = useIsMobile();
  if (isMobile) return null;

  return (
    <nav
      id="primary-sidebar"
      aria-label={ariaLabel}
      style={{
        width: collapsed ? layoutTokens.sidebarCollapsedWidth : layoutTokens.sidebarWidth,
        flexShrink: 0,
        borderRight: `1px solid ${colorTokens.borderColor}`,
        background: colorTokens.cardBackground,
        display: 'flex',
        flexDirection: 'column',
        gap: layoutTokens.contentPadding,
        padding: layoutTokens.contentPadding,
        boxSizing: 'border-box',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: layoutTokens.headerHeight,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: colorTokens.primary,
            color: colorTokens.textInverse,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          CA
        </span>
        {collapsed ? null : (
          <Typography.Text strong style={{ color: colorTokens.textPrimary, whiteSpace: 'nowrap' }}>
            Commerce Admin
          </Typography.Text>
        )}
      </div>

      <NavItemList currentRoute={currentRoute} onNavigate={onNavigate} collapsed={collapsed} />

      {collapsed ? null : (
        <p
          style={{
            marginTop: 'auto',
            marginBottom: 0,
            color: colorTokens.textTertiary,
            fontSize: fontTokens.fontSizeSmall,
            lineHeight: 1.5,
          }}
        >
          Data lives in this browser. {ROUTE_TITLES[currentRoute]} reflects the local workspace only.
        </p>
      )}
    </nav>
  );
};

export default SidebarNav;
