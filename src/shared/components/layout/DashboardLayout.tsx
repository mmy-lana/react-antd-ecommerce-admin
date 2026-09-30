/**
 * The application shell (plan Task 5.1).
 *
 * Unifies the three navigation surfaces behind one breakpoint decision:
 *
 *  - **>= 768px** — `SidebarNav` is permanently visible and the header carries
 *    the page title and workspace summary;
 *  - **< 768px** — the sidebar is absent and `MobileNavDrawer` is opened from
 *    the header's menu button.
 *
 * The shell owns that single decision (via `useResponsiveNavigation`) and passes
 * the result down, so the two surfaces can never both be active. The content
 * column is capped at `contentMaxWidth` and the page is locked to
 * `overflow-x: hidden` at the root, which is what keeps every view free of
 * horizontal scrolling on a 360px screen.
 *
 * The layout body is exported as {@link DashboardLayoutBody} so the suite can
 * render it without a portal.
 */

import { Breadcrumb, Typography } from 'antd';
import { useCallback, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { APP_TITLE, ROUTE_TITLES, useRouter, type RoutePath } from '../../../app/Router';
import { useResponsiveNavigation } from '../../hooks/useResponsiveNavigation';
import { useIsCompact } from '../primitives/ResponsiveContainer';
import { HeaderBar } from './HeaderBar';
import { MobileNavDrawer } from './MobileNavDrawer';
import { SidebarNav } from './SidebarNav';

export interface DashboardLayoutBodyProps {
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
  children: ReactNode;
  /** Passed to the header; omitted by the suite, which has no database. */
  summary?: { products: number; alerts: number } | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra header controls contributed by the active view. */
  headerControls?: ReactNode;
}

/**
 * Sidebar + header + content, with the drawer floating above.
 *
 * Split from {@link DashboardLayout} so the arrangement can be asserted without
 * IndexedDB or a router.
 */
export const DashboardLayoutBody: FC<DashboardLayoutBodyProps> = ({
  currentRoute,
  onNavigate,
  children,
  summary = null,
  onRefresh,
  refreshing = false,
  headerControls,
}) => {
  const navigation = useResponsiveNavigation();
  const compact = useIsCompact();

  const contentPadding = compact ? layoutTokens.contentPaddingCompact : layoutTokens.contentPadding;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        width: '100%',
        // Never scroll sideways: wide tables scroll inside their own container.
        overflowX: 'hidden',
        minHeight: '100vh',
      }}
    >
      <SidebarNav
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        collapsed={navigation.sidebarCollapsed}
      />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <HeaderBar
          currentRoute={currentRoute}
          summary={summary}
          refreshing={refreshing}
          {...(onRefresh === undefined ? {} : { onRefresh })}
          {...(headerControls === undefined ? {} : { children: headerControls })}
          {...(navigation.isMobile ? { onOpenNavigation: navigation.openDrawer } : {})}
        />

        <main
          id="main-content"
          tabIndex={-1}
          style={{
            flex: 1,
            minWidth: 0,
            padding: contentPadding,
            display: 'flex',
            flexDirection: 'column',
            gap: contentPadding,
          }}
        >
          <Breadcrumb
            items={[{ title: APP_TITLE }, { title: ROUTE_TITLES[currentRoute] }]}
            style={{ fontSize: fontTokens.fontSizeSmall }}
          />
          {children}
        </main>
      </div>

      <MobileNavDrawer
        open={navigation.drawerOpen}
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onClose={navigation.closeDrawer}
        footer={
          <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
            This workspace is stored in your browser.
          </Typography.Text>
        }
      />
    </div>
  );
};

export interface DashboardLayoutProps {
  children: ReactNode;
  summary?: { products: number; alerts: number } | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  headerControls?: ReactNode;
}

/**
 * Connected layout: reads the route from the router and owns navigation state.
 */
export const DashboardLayout: FC<DashboardLayoutProps> = ({ children, ...body }) => {
  const { currentRoute, navigate } = useRouter();

  const handleNavigate = useCallback((route: RoutePath) => navigate(route), [navigate]);

  return (
    <DashboardLayoutBody currentRoute={currentRoute} onNavigate={handleNavigate} {...body}>
      {children}
    </DashboardLayoutBody>
  );
};

export default DashboardLayout;
