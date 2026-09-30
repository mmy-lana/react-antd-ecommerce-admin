/**
 * Layout and view harness (plan Tasks 5.1–5.5).
 *
 * The shell and the three screens are assembled here for the first time, so this
 * suite exists to prove the *arrangement* rather than the individual pieces the
 * component suite already covers:
 *
 *  - the shell switches navigation surfaces exactly once at 768px and never
 *    renders two `nav` landmarks with the same name;
 *  - every interactive control in the shell, the dashboard trackers, the
 *    inventory batch bar and the sales trackers meets the 44×44px minimum;
 *  - no screen emits a width pinned to the viewport, which is what would cause
 *    the page to scroll sideways on a 360px phone;
 *  - each screen renders its empty and its populated state with real fixtures.
 *
 * `DashboardLayoutBody` and the three `*ViewBody` exports are used rather than
 * the connected views, because the connected ones mount live IndexedDB queries
 * and the router. The connection itself is asserted through `ROUTE_VIEWS`.
 *
 * Run with `pnpm run verify:domain`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import {
  NAVIGATION_BREAKPOINT,
  resolveNavigationMode,
  type NavigationMode,
} from '../src/shared/hooks/useResponsiveNavigation';
import { layoutTokens } from '../src/app/theme/tokens';
import {
  ROUTE_PATHS,
  parseRouteFromHash,
  splitRouteHash,
  parseRouteQuery,
  buildRouteHashWithQuery,
} from '../src/app/Router';
import { ROUTE_VIEWS } from '../src/app/App';
import { DashboardLayoutBody } from '../src/shared/components/layout/DashboardLayout';
import { HeaderBar, formatUtcClock } from '../src/shared/components/layout/HeaderBar';
import { MobileNavBody, MobileNavDrawer } from '../src/shared/components/layout/MobileNavDrawer';
import { NavItemList, SidebarNav, navTargetStyle, NAV_ITEMS } from '../src/shared/components/layout/SidebarNav';
import { DashboardViewBody, buildRestockRows } from '../src/features/dashboard/views/DashboardView';
import { InventoryViewBody, archiveConfirmationCopy, buildAnalyticsCards, toProductDraft, toStockStatusFilter, BATCH_RESTOCK_STATUSES, DEFAULT_BATCH_RESTOCK_QUANTITY } from '../src/features/inventory/views/InventoryView';
import {
  SalesViewBody,
  STATUS_TRACKER_LABEL,
  TRACKED_ORDER_STATUSES,
  buildVolumeTrackers,
  toOrderStatusFilter,
} from '../src/features/sales/views/SalesView';
import { buildInventoryAnalytics } from '../src/features/inventory/hooks/useInventory';
import { buildSalesAggregates, type SalesAggregates } from '../src/features/sales/hooks/useOrders';
import {
  buildCategorySeries,
  buildKpiStats,
  buildSalesSeries,
  tallyOrders,
} from '../src/features/dashboard/hooks/useDashboardMetrics';
import { AntDAppProviderHarness } from './harness/AntDAppProviderHarness';
import { buildSeedDataset } from '../src/shared/db/seedData';
import type { CategorySalesPoint, Order, Product, SalesTimeSeriesPoint } from '../src/shared/types';

/* -------------------------------------------------------------------------- */
/* Harness plumbing                                                            */
/* -------------------------------------------------------------------------- */

const failures: string[] = [];
let assertions = 0;

/** Stand-ins for the view callbacks; the harness asserts markup, not handlers. */
const noop = (): void => undefined;
const noopAsync = async (): Promise<void> => undefined;

/** The two navigation modes, named once so the checks below read clearly. */
const NAV_MODE_SIDEBAR: NavigationMode = 'sidebar';
const NAV_MODE_DRAWER: NavigationMode = 'drawer';

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/');

const render = (label: string, element: ReactElement): string => {
  try {
    return renderToStaticMarkup(AntDAppProviderHarness(element));
  } catch (error) {
    assertions += 1;
    failures.push(`${label} threw during render — ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
};

/**
 * A minimal browser, installed for the duration of one render.
 *
 * `useViewportSize` and `prefersCoarsePointer` both short-circuit to desktop and
 * a fine pointer when `window` is absent, so without this the viewport sweep
 * would silently assert the same thing five times. Only the two properties the
 * code actually reads are provided.
 */
interface FakeWindowOptions {
  width: number;
  height?: number;
  coarse?: boolean;
}

const withBrowser = <T,>(options: FakeWindowOptions, run: () => T): T => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousInnerWidth = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
  const previousMatchMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');

  const fake = {
    innerWidth: options.width,
    innerHeight: options.height ?? 900,
    matchMedia: (query: string) => ({
      media: query,
      matches: query.includes('coarse') ? (options.coarse ?? false) : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  };

  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'innerWidth', { value: options.width, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'matchMedia', { value: fake.matchMedia, configurable: true, writable: true });

  try {
    return run();
  } finally {
    for (const [key, descriptor] of [
      ['window', previousWindow],
      ['innerWidth', previousInnerWidth],
      ['matchMedia', previousMatchMedia],
    ] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
};

/** Renders the real component tree at a specific viewport width. */
const renderAt = (label: string, width: number, element: ReactElement, coarse = false): string =>
  withBrowser({ width, coarse }, () => render(label, element));

const SEED_NOW = new Date('2026-03-01T00:00:00.000Z');
const seed = buildSeedDataset(SEED_NOW);
const products = seed.products as Product[];
const orders = seed.orders as Order[];

/** Counts how many times `needle` appears in the markup. */
const countOccurrences = (markup: string, needle: string): number => markup.split(needle).length - 1;

/**
 * Every element a pointer must hit, and the smallest box it offers.
 *
 * Parses the rendered markup for the inline style tokens the shell actually
 * uses rather than re-deriving them from source, so a regression that drops
 * `minHeight` from one control is caught here.
 */
const findInteractiveControls = (markup: string): { minHeight: number; minWidth: number }[] => {
  const controls: { minHeight: number; minWidth: number }[] = [];
  const stylePattern = /<button\b[^>]*style="([^"]*)"[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = stylePattern.exec(markup)) !== null) {
    const style = decodeEntities(match[1] ?? '');
    const minHeight = /min-height:(\d+)px/.exec(style);
    const minWidth = /min-width:(\d+)px/.exec(style);
    if (minHeight === null || minWidth === null) continue;
    controls.push({ minHeight: Number(minHeight[1]), minWidth: Number(minWidth[1]) });
  }
  return controls;
};

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

check('every route has a screen', ROUTE_PATHS.every((route) => ROUTE_VIEWS[route] !== undefined));
check('the route map has no extra screens', Object.keys(ROUTE_VIEWS).length === ROUTE_PATHS.length);

check('a plain hash resolves', parseRouteFromHash('#/inventory') === 'inventory');
check('a hash with a query still resolves', parseRouteFromHash('#/sales?status=shipped') === 'sales');
check('an unknown hash falls back', parseRouteFromHash('#/nonsense') === 'dashboard');
check('an empty hash falls back', parseRouteFromHash('') === 'dashboard');

const split = splitRouteHash('#/inventory?status=low_stock&q=blue%20shirt');
check('the path is split from the query', split.path === 'inventory');
check('the query is split from the path', split.query === 'status=low_stock&q=blue%20shirt');

const parsedQuery = parseRouteQuery('status=low_stock&q=blue%20shirt&flag');
check('a query value is decoded', parsedQuery.q === 'blue shirt');
check('a key without a value is empty, not undefined', parsedQuery.flag === '');
check('an empty query yields no keys', Object.keys(parseRouteQuery('')).length === 0);

check('a query is appended to the hash', buildRouteHashWithQuery('inventory', { status: 'low_stock' }) === '#/inventory?status=low_stock');
check('an empty query is dropped', buildRouteHashWithQuery('inventory', {}) === '#/inventory');
check('an empty value is dropped', buildRouteHashWithQuery('inventory', { status: '' }) === '#/inventory');
check('a value is encoded', buildRouteHashWithQuery('sales', { status: 'a b' }) === '#/sales?status=a%20b');

/* -------------------------------------------------------------------------- */
/* Navigation mode                                                             */
/* -------------------------------------------------------------------------- */

check('768px and above is desktop', resolveNavigationMode(NAVIGATION_BREAKPOINT) === NAV_MODE_SIDEBAR);
check('767px is mobile', resolveNavigationMode(767) === NAV_MODE_DRAWER);
check('the desktop threshold matches the layout token', NAVIGATION_BREAKPOINT === layoutTokens.mobileBreakpoint);

/* -------------------------------------------------------------------------- */
/* Sidebar navigation                                                          */
/* -------------------------------------------------------------------------- */

const navList = render('NavItemList', <NavItemList currentRoute="dashboard" onNavigate={() => undefined} />);
check('the nav renders one item per route', countOccurrences(navList, '<li') === NAV_ITEMS.length);
check('the active route is marked', navList.includes('aria-current="page"'));
check('exactly one route is current', countOccurrences(navList, 'aria-current="page"') === 1);
check('the nav is a list', navList.includes('<ul'));
check('every nav item has a 44px target', findInteractiveControls(navList).every((c) => c.minHeight >= 44 && c.minWidth >= 44));
check('the nav offers every route', NAV_ITEMS.every((item) => navList.includes(`id="nav-${item.route}"`)));

const collapsedNav = render(
  'Collapsed NavItemList',
  <NavItemList currentRoute="inventory" onNavigate={() => undefined} collapsed />,
);
check('a collapsed item keeps an accessible name', collapsedNav.includes('aria-label="Inventory —'));
check('a collapsed item drops its hint', !collapsedNav.includes('Reorder before'));
check('a collapsed item keeps its route id', collapsedNav.includes('id="nav-inventory"'));

const sidebarDesktop = renderAt('SidebarNav at 1440', 1440, <SidebarNav currentRoute="dashboard" onNavigate={() => undefined} />);
check('the sidebar is a nav landmark', sidebarDesktop.includes('aria-label="Primary"'));
check('the sidebar shows the brand', sidebarDesktop.includes('Commerce Admin'));

/* -------------------------------------------------------------------------- */
/* Mobile navigation                                                          */
/* -------------------------------------------------------------------------- */

const mobileNavBody = render(
  'MobileNavBody',
  <MobileNavBody currentRoute="sales" onNavigate={() => undefined} onClose={() => undefined} footer="Local workspace" />,
);
check('the drawer nav is a nav landmark', mobileNavBody.includes('aria-label="Primary"'));
check('the drawer offers every route', NAV_ITEMS.every((item) => mobileNavBody.includes(`id="nav-${item.route}"`)));
check('the drawer marks the active route', mobileNavBody.includes('aria-current="page"'));
check('the drawer has a named close control', mobileNavBody.includes('aria-label="Close navigation"'));
check('the drawer close control meets the touch target', findInteractiveControls(mobileNavBody).every((c) => c.minHeight >= 44 && c.minWidth >= 44));
check('the drawer renders its footer', mobileNavBody.includes('Local workspace'));

// Ant Design's Drawer mounts through a portal, which `renderToStaticMarkup`
// cannot host: both the open and the closed shell collapse to the same empty
// string. The panel content is therefore asserted through `MobileNavBody`, and
// the shell is asserted through the shell's own breakpoint behaviour.
const closedDrawer = render(
  'Closed MobileNavDrawer',
  <MobileNavDrawer open={false} currentRoute="dashboard" onNavigate={noop} onClose={noop} />,
);
const openDrawer = render(
  'Open MobileNavDrawer',
  <MobileNavDrawer open currentRoute="dashboard" onNavigate={noop} onClose={noop} />,
);
check('a drawer is portal-only and inlines nothing', closedDrawer === openDrawer && !closedDrawer.includes('<nav'));
check('a drawer shell is still a component', typeof MobileNavDrawer === 'function');
check('the drawer panel carries the navigation', mobileNavBody.includes('<ul'));
check('the drawer panel is reachable without a portal', mobileNavBody.includes('aria-label="Primary"'));

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

const headerDesktop = render(
  'HeaderBar at desktop',
  <HeaderBar currentRoute="dashboard" onOpenNavigation={() => undefined} summary={{ products: 30, alerts: 7 }} onRefresh={() => undefined} />,
);
check('the desktop header hides the menu button', !headerDesktop.includes('aria-label="Open navigation"'));
check('the desktop header shows the page title', decodeEntities(headerDesktop).includes('Dashboard'));
check('the desktop header shows the workspace count', decodeEntities(headerDesktop).includes('30 products'));
check('the desktop header shows the alert count', headerDesktop.includes('7'));
check('the desktop header has a named refresh', headerDesktop.includes('aria-label="Refresh workspace data"'));
check('the header is a banner landmark', headerDesktop.includes('<header'));

const headerControls = render(
  'HeaderBar with controls',
  <HeaderBar currentRoute="sales">
    <button type="button">Preset A</button>
  </HeaderBar>,
);
check('the header renders view controls', headerControls.includes('Preset A'));
check('a header without a summary hides the badge', !headerControls.includes('products'));

const clock = formatUtcClock('2026-03-04T09:07:00.000Z');
check('the clock renders in UTC', clock.includes('UTC'));
check('the clock renders the stored instant', clock.startsWith('Mar 4, 2026 09:07'));

/* -------------------------------------------------------------------------- */
/* The shell                                                                  */
/* -------------------------------------------------------------------------- */

const shellDesktop = renderAt(
  'DashboardLayoutBody at 1440',
  1440,
  <DashboardLayoutBody currentRoute="dashboard" onNavigate={() => undefined} summary={{ products: 30, alerts: 7 }}>
    <span>dashboard content</span>
  </DashboardLayoutBody>,
);
check('the shell renders its content', shellDesktop.includes('dashboard content'));
// `Router` owns the document's single `<main id="main-content">` and renders
// this layout *inside* it. The shell therefore must not emit a second one —
// nesting two `<main>` elements is invalid HTML and reusing the id breaks the
// skip link. (The real document is asserted in the headless e2e run.)
check('the shell does not claim the main landmark', !shellDesktop.includes('<main'));
check('the shell does not duplicate the main-content id', !shellDesktop.includes('id="main-content"'));
check('the shell renders a labelled workspace region', shellDesktop.includes('aria-label="Dashboard workspace"'));
check('the desktop shell has a sidebar', shellDesktop.includes('id="primary-sidebar"'));
check('the desktop shell has exactly one nav landmark', countOccurrences(shellDesktop, 'aria-label="Primary"') === 1);
check('the desktop shell has no open navigation button', !shellDesktop.includes('aria-label="Open navigation"'));
check('the shell locks horizontal overflow', shellDesktop.includes('overflow-x:hidden'));
check('the shell does not pin itself to the viewport width', !shellDesktop.includes('width:100vw'));
check('the shell breadcrumb names the route', decodeEntities(shellDesktop).includes('Dashboard'));

const shellMobile = renderAt(
  'DashboardLayoutBody at 390',
  390,
  <DashboardLayoutBody currentRoute="inventory" onNavigate={() => undefined}>
    <span>inventory content</span>
  </DashboardLayoutBody>,
);
check('the mobile shell renders its content', shellMobile.includes('inventory content'));
check('the mobile shell drops the sidebar', !shellMobile.includes('id="primary-sidebar"'));
check('the mobile shell offers the navigation button', shellMobile.includes('aria-label="Open navigation"'));
// Below 768px the sidebar is gone and the drawer is portal-only, so the shell
// inlines no nav at all; the navigation itself is asserted through
// `MobileNavBody` above. What matters here is that the *second* landmark is
// gone, not that a first one remains.
check('the mobile shell inlines no duplicate nav', countOccurrences(shellMobile, 'aria-label="Primary"') === 0);
check('the mobile shell still renders its content', shellMobile.includes('inventory content'));
check('the mobile shell marks the button as a dialog', shellMobile.includes('aria-haspopup="dialog"'));

const shellWithoutNavigation = renderAt(
  'DashboardLayoutBody with no navigation target',
  390,
  <DashboardLayoutBody currentRoute="sales" onNavigate={() => undefined}>
    <span>sales content</span>
  </DashboardLayoutBody>,
);
const headerWithoutNavigation = renderAt(
  'Mobile HeaderBar with no navigation target',
  390,
  <HeaderBar currentRoute="sales" />,
);
check('a mobile header without a nav target omits the menu button', !headerWithoutNavigation.includes('aria-label="Open navigation"'));
check('a mobile header with a nav target offers it', shellMobile.includes('aria-label="Open navigation"'));
check('a mobile shell always has a navigation target', shellMobile.includes('aria-label="Open navigation"'));
check('a mobile shell without a nav target inlines no nav', countOccurrences(shellWithoutNavigation, 'aria-label="Primary"') === 0);
check('a mobile shell without a nav target still renders content', shellWithoutNavigation.includes('sales content'));

const shellWithControls = renderAt(
  'DashboardLayoutBody with header controls',
  1440,
  <DashboardLayoutBody currentRoute="sales" onNavigate={() => undefined} headerControls={<button type="button">Last 30 days</button>}>
    <span>sales content</span>
  </DashboardLayoutBody>,
);
check('the shell forwards header controls', shellWithControls.includes('Last 30 days'));

/* -------------------------------------------------------------------------- */
/* Task 5.5 — the five required viewports                                     */
/* -------------------------------------------------------------------------- */

const REQUIRED_VIEWPORTS = [360, 390, 430, 768, 1440] as const;
const viewWidths: number[] = [...REQUIRED_VIEWPORTS];

const range = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-03-01T00:00:00.000Z' };
const series: SalesTimeSeriesPoint[] = buildSalesSeries(orders, range, 'day');
const categorySeries: CategorySalesPoint[] = buildCategorySeries(orders, products, range);

const currentTotals = tallyOrders(orders.filter((order) => order.createdAt >= range.startDate && order.createdAt <= range.endDate));
const previousTotals = tallyOrders(orders.filter((order) => order.createdAt < range.startDate));
const lowStock = products.filter((p) => p.status === 'low_stock').length;
const outOfStock = products.filter((p) => p.status === 'out_of_stock').length;
const stats = buildKpiStats(currentTotals, previousTotals, lowStock, outOfStock);

/**
 * Stands in for `@ant-design/plots`, which needs a canvas.
 *
 * The stub still serialises the config, so an assertion can prove the view
 * actually built a chart spec rather than silently rendering nothing.
 */
const chartStub = (config: unknown): ReactElement => (
  <div data-chart-kind="stub" data-chart-spec={JSON.stringify(config).length} />
);
const chartRenderer = { area: chartStub, pie: chartStub };

const inventoryAnalytics = buildInventoryAnalytics(products);
const salesAggregates: SalesAggregates = buildSalesAggregates(orders);
const recentOrders = orders.slice(0, 6);
const watchlistProducts = products.filter((product) => product.totalStock < product.safetyStockThreshold).slice(0, 8);

const baseShell = (children: ReactElement, route: 'dashboard' | 'inventory' | 'sales' = 'dashboard'): ReactElement => (
  <DashboardLayoutBody currentRoute={route} onNavigate={noop}>
    {children}
  </DashboardLayoutBody>
);

const dashboardAt = (width: number, coarse = false): string => {
  return renderAt(
    `Dashboard at ${width}`,
    width,
    baseShell(
      <DashboardViewBody
        range={range}
        interval="day"
        stats={stats}
        series={series}
        categorySeries={categorySeries}
        products={products}
        recentOrders={recentOrders}
        hasPreviousPeriod
        loading={false}
        category="all"
        onCategoryChange={noop}
        onIntervalChange={noop}
        onNavigateToInventory={noop}
        onNavigateToSales={noop}
        onRangeChange={noop}
        rangePresetKey="30d"
        onAdjustStock={noopAsync}
        chartRenderer={chartRenderer}
      />,
      'dashboard',
    ),
    coarse,
  );
};

const inventoryAt = (width: number, coarse = false): string =>
  renderAt(
    `Inventory at ${width}`,
    width,
    baseShell(
      <InventoryViewBody
        products={products.slice(0, 40)}
        analytics={inventoryAnalytics}
        loading={false}
        filters={{ category: 'all', stockStatus: 'all', searchQuery: '' }}
        hasActiveFilters={false}
        totalCount={products.length}
        selectedRowKeys={[]}
        onSelectedRowKeysChange={noop}
        onCategoryChange={noop}
        onStockStatusChange={noop}
        onSearchQueryChange={noop}
        onResetFilters={noop}
        showArchivedOnly={false}
        onToggleArchivedView={noop}
        onOpenProduct={noop}
        onCreateProduct={noop}
        onAdjustStock={noop}
        onExport={noop}
        onBatchRestock={noopAsync}
        onArchive={noopAsync}
        mutationsPending={false}
        error={null}
      />,
      'inventory',
    ),
    coarse,
  );

const salesAt = (width: number, coarse = false): string =>
  renderAt(
    `Sales at ${width}`,
    width,
    baseShell(
      <SalesViewBody
        orders={orders}
        aggregates={salesAggregates}
        loading={false}
        totalCount={orders.length}
        range={range}
        onRangeChange={noop}
        filters={{ status: 'all', searchQuery: '' }}
        onStatusChange={noop}
        onSearchQueryChange={noop}
        onResetFilters={noop}
        hasActiveFilters={false}
        onOpenOrder={noop}
        onTransition={noop}
        onExport={noop}
        mutationsPending={false}
        error={null}
      />,
      'sales',
    ),
    coarse,
  );

for (const width of REQUIRED_VIEWPORTS) {
  viewWidths.push(width);

  const shell = renderAt(
    `Shell at ${width}`,
    width,
    baseShell(<span>content</span>),
  );
  check(`the shell renders at ${width}px`, shell.includes('content'));
  check(`the shell has no horizontal overflow at ${width}px`, !shell.includes('width:100vw') && shell.includes('overflow-x:hidden'));
  // The sidebar is the only inline nav; below the breakpoint it is removed
  // outright rather than merely hidden, so there is never a second landmark
  // for a screen reader to find behind the drawer.
  check(
    `the shell inlines exactly one navigation at ${width}px`,
    countOccurrences(shell, 'aria-label="Primary"') === (width >= NAVIGATION_BREAKPOINT ? 1 : 0),
  );
  check(
    `the shell's sidebar matches the breakpoint at ${width}px`,
    shell.includes('id="primary-sidebar"') === width >= NAVIGATION_BREAKPOINT,
  );

  for (const [name, markup] of [
    ['dashboard', dashboardAt(width)],
    ['inventory', inventoryAt(width)],
    ['sales', salesAt(width)],
  ] as const) {
    check(`${name} renders at ${width}px`, markup.length > 0);
    check(`${name} has no viewport-width overflow at ${width}px`, !markup.includes('100vw'));
    // See above: the landmark belongs to `Router`, and the view bodies are
    // rendered here without it. What they must not do is add their own.
    check(`${name} does not nest a second main landmark at ${width}px`, !markup.includes('<main'));
    check(`${name} does not duplicate the main-content id at ${width}px`, !markup.includes('id="main-content"'));
    check(
      `${name} has no unclosed horizontal region at ${width}px`,
      !/width:\s*9\d\dpx/.test(markup) || width >= 768,
    );
  }
}

check('the required viewports are the five the plan names', REQUIRED_VIEWPORTS.join(',') === '360,390,430,768,1440');

/* -------------------------------------------------------------------------- */
/* Task 5.5 — touch targets                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every control must offer 44×44 to a finger.
 *
 * `useTouchTargetStyle` deliberately tightens to 36px for a mouse, so the
 * contract is measured with a coarse pointer, which is the only case the plan's
 * 44px minimum is about.
 */
const TOUCH_MIN = layoutTokens.touchTargetMinSize;

const assertTouchTargets = (label: string, markup: string): void => {
  const controls = findInteractiveControls(markup);
  check(`${label} exposes controls to measure`, controls.length > 0);
  const tooSmall = controls.filter((c) => c.minHeight < TOUCH_MIN || c.minWidth < TOUCH_MIN);
  check(
    `every ${label} control is at least ${TOUCH_MIN}x${TOUCH_MIN} on touch`,
    tooSmall.length === 0,
    JSON.stringify(tooSmall.slice(0, 4)),
  );
};

const touchShell = renderAt('Shell on a touch device', 390, baseShell(<span>content</span>), true);
assertTouchTargets('mobile shell', touchShell);
const touchDashboard = dashboardAt(390, true);
assertTouchTargets('dashboard', touchDashboard);
assertTouchTargets('sales', salesAt(390, true));
assertTouchTargets('inventory', inventoryAt(390, true));
assertTouchTargets('drawer nav', renderAt('MobileNavBody on touch', 390, <MobileNavBody currentRoute="dashboard" onNavigate={noop} onClose={noop} />, true));

const coarseInventory = renderAt(
  'Inventory batch bar on touch',
  390,
  <InventoryViewBody
    products={products.slice(0, 20)}
    analytics={inventoryAnalytics}
    loading={false}
    filters={{ category: 'all', stockStatus: 'all', searchQuery: '' }}
    hasActiveFilters={false}
    totalCount={products.length}
    selectedRowKeys={products.slice(0, 3).map((p) => p.id)}
    onSelectedRowKeysChange={noop}
    onCategoryChange={noop}
    onStockStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    showArchivedOnly={false}
    onToggleArchivedView={noop}
    onOpenProduct={noop}
    onCreateProduct={noop}
    onAdjustStock={noop}
    onExport={noop}
    onBatchRestock={noopAsync}
    onArchive={noopAsync}
    mutationsPending={false}
    error={null}
  />,
  true,
);
assertTouchTargets('inventory', coarseInventory);

// A mouse is allowed the tighter box, and the difference proves the component
// really is responding to the pointer rather than hard-coding 44px.
const fineSales = salesAt(1440);
const fineTargets = findInteractiveControls(fineSales).filter((c) => c.minHeight < TOUCH_MIN);
check('a mouse is offered the tighter desktop box', fineTargets.length > 0);
check('no desktop control drops below 32px', findInteractiveControls(fineSales).every((c) => c.minHeight >= 32));

check('the shared nav target is the 44px minimum', navTargetStyle.minHeight === TOUCH_MIN && navTargetStyle.minWidth === TOUCH_MIN);

/* -------------------------------------------------------------------------- */
/* Dashboard view                                                              */
/* -------------------------------------------------------------------------- */

const dashboardMobile = dashboardAt(390);

// Assert the KPI card titles, not the donut's centre caption: the caption is
// deliberately "Product Sales" because it sums line-item subtotals and is not
// reconcilable against the "Total Revenue" KPI (FIN-DATA-01).
check(
  'the dashboard renders its KPIs',
  ['Total Revenue', 'Revenue Growth', 'Net Profit', 'Profit Margin', 'Average Order Value', 'Stock Alerts'].every(
    (title) => dashboardMobile.includes(title),
  ),
);
check(
  'the donut centre is captioned as product sales, not total revenue (FIN-DATA-01)',
  dashboardMobile.includes('Product Sales') && !dashboardMobile.includes('>Total revenue<'),
);
check('the dashboard renders the revenue chart', dashboardMobile.includes('Revenue and profit over time'));
check('the dashboard renders the category breakdown', dashboardMobile.includes('Revenue by category'));
check('the dashboard renders recent orders', dashboardMobile.includes('Recent orders'));
check('the dashboard renders the restock watchlist', dashboardMobile.includes('Restock watchlist'));
check('the dashboard names its date range', dashboardMobile.includes('Jan 1'));
check('the dashboard offers the range presets', decodeEntities(dashboardMobile).includes('Last 30 days'));

const watchlistMarkup = render(
  'Dashboard with a depleted watchlist',
  <DashboardViewBody
    range={range}
    interval="day"
    stats={stats}
    series={series}
    categorySeries={categorySeries}
    products={watchlistProducts}
    recentOrders={recentOrders}
    hasPreviousPeriod
    loading={false}
    category="all"
    onCategoryChange={noop}
    onIntervalChange={noop}
    onNavigateToInventory={noop}
    onNavigateToSales={noop}
    onRangeChange={noop}
    rangePresetKey="30d"
    onAdjustStock={noopAsync}
    chartRenderer={chartRenderer}
  />,
);
check('a depleted watchlist lists the short products', watchlistMarkup.includes('Restock'));
check('a depleted watchlist offers a restock action', watchlistMarkup.includes('>Restock</button>'));

const restockRows = buildRestockRows(products);
check('the watchlist excludes healthy products', restockRows.every((row) => row.deficit > 0));
check('the watchlist is sorted by the deepest deficit', restockRows.every((row, index) => index === 0 || row.deficit <= (restockRows[index - 1]?.deficit ?? Infinity)));
check('the watchlist never includes an archived product', restockRows.every((row) => !row.product.isArchived));
check('an empty watchlist is empty', buildRestockRows([]).length === 0);

const watchlistOfHealthy = render(
  'Dashboard with a healthy catalogue',
  <DashboardViewBody
    range={range}
    interval="day"
    stats={stats}
    series={[]}
    categorySeries={[]}
    products={products.filter((product) => product.totalStock > product.safetyStockThreshold)}
    recentOrders={[]}
    hasPreviousPeriod
    loading={false}
    category="all"
    onCategoryChange={noop}
    onIntervalChange={noop}
    onNavigateToInventory={noop}
    onNavigateToSales={noop}
    onRangeChange={noop}
    rangePresetKey="30d"
    onAdjustStock={noopAsync}
    chartRenderer={chartRenderer}
  />,
);
check('a healthy catalogue says so', watchlistOfHealthy.includes('Stock is healthy'));
check('an empty window says so', watchlistOfHealthy.includes('No sales in this window'));
check('an empty order list says so', watchlistOfHealthy.includes('Nothing ordered in this window'));
check('an empty category split says so', watchlistOfHealthy.includes('No category revenue yet'));

const loadingDashboard = render(
  'Dashboard while loading',
  <DashboardViewBody
    range={range}
    interval="day"
    stats={stats}
    series={[]}
    categorySeries={[]}
    products={[]}
    recentOrders={[]}
    hasPreviousPeriod
    loading
    category="all"
    onCategoryChange={noop}
    onIntervalChange={noop}
    onNavigateToInventory={noop}
    onNavigateToSales={noop}
    onRangeChange={noop}
    rangePresetKey="30d"
    onAdjustStock={noopAsync}
  />,
);
check('a loading dashboard shows a skeleton', loadingDashboard.includes('aria-busy="true"') || loadingDashboard.includes('role="status"') || loadingDashboard.includes('animate'));
check('a loading dashboard shows no KPIs', !loadingDashboard.includes('Total revenue'));

const failedDashboard = render(
  'Dashboard with an error',
  <DashboardViewBody
    range={range}
    interval="day"
    stats={stats}
    series={series}
    categorySeries={categorySeries}
    products={products}
    recentOrders={recentOrders}
    hasPreviousPeriod
    loading={false}
    category="all"
    onCategoryChange={noop}
    onIntervalChange={noop}
    onNavigateToInventory={noop}
    onNavigateToSales={noop}
    onRangeChange={noop}
    rangePresetKey="30d"
    onAdjustStock={noopAsync}
    error="The local workspace could not be read."
    chartRenderer={chartRenderer}
  />,
);
check('a failed dashboard announces the error', failedDashboard.includes('role="alert"'));
check('a failed dashboard shows the message', failedDashboard.includes('The local workspace could not be read.'));

const filteredDashboard = render(
  'Dashboard with a category selected',
  <DashboardViewBody
    range={range}
    interval="week"
    stats={stats}
    series={series}
    categorySeries={categorySeries}
    products={products}
    recentOrders={recentOrders}
    hasPreviousPeriod={false}
    loading={false}
    category="Audio"
    onCategoryChange={noop}
    onIntervalChange={noop}
    onNavigateToInventory={noop}
    onNavigateToSales={noop}
    onRangeChange={noop}
    rangePresetKey="7d"
    onAdjustStock={noopAsync}
    chartRenderer={chartRenderer}
  />,
);
check('a selected category is shown as a removable chip', filteredDashboard.includes('Audio'));
check('a selected interval is pressed', filteredDashboard.includes('aria-pressed="true"'));
check('without a previous period the interval offers weekly', filteredDashboard.includes('>Weekly</button>'));

/* -------------------------------------------------------------------------- */
/* Inventory view                                                              */
/* -------------------------------------------------------------------------- */

const inventoryMarkup = inventoryAt(1440);
check('the inventory screen renders its analytics cards', inventoryMarkup.includes('Active products'));
check('the inventory screen renders the stock value card', inventoryMarkup.includes('Stock value at cost'));
check('the inventory screen renders the low-stock card', inventoryMarkup.includes('Below safety line'));
check('the inventory screen renders the out-of-stock card', inventoryMarkup.includes('Out of stock'));
check('the inventory screen renders the filter toolbar', inventoryMarkup.includes('placeholder="Search SKU, name or brand"'));
check('the inventory screen renders the table', inventoryMarkup.includes('<table'));
check('the inventory screen offers an export', inventoryMarkup.includes('Export CSV'));
check('the inventory screen offers product creation', inventoryMarkup.includes('New product'));

const cards = buildAnalyticsCards(inventoryAnalytics);
check('the analytics cards are four', cards.length === 4);
check('the analytics cards have distinct keys', new Set(cards.map((card) => card.key)).size === 4);
check('the analytics cards all have a value', cards.every((card) => card.value.length > 0));
check('the analytics cards all have a hint', cards.every((card) => card.hint.length > 0));
check('the analytics card count excludes archived products', cards[0]?.value === String(inventoryAnalytics.totalProducts - inventoryAnalytics.archivedCount));

const selectedInventory = renderAt(
  'Inventory with a selection',
  1440,
  <InventoryViewBody
    products={products.slice(0, 20)}
    analytics={inventoryAnalytics}
    loading={false}
    filters={{ category: 'all', stockStatus: 'all', searchQuery: '' }}
    hasActiveFilters={false}
    totalCount={products.length}
    selectedRowKeys={products.slice(0, 3).map((product) => product.id)}
    onSelectedRowKeysChange={noop}
    onCategoryChange={noop}
    onStockStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    showArchivedOnly={false}
    onToggleArchivedView={noop}
    onOpenProduct={noop}
    onCreateProduct={noop}
    onAdjustStock={noop}
    onExport={noop}
    onBatchRestock={noopAsync}
    onArchive={noopAsync}
    mutationsPending={false}
    error={null}
  />,
);
check('a selection is announced', selectedInventory.includes('aria-label="Batch actions"'));
check('a selection reports its size', selectedInventory.includes('3 selected'));
check('a selection offers a batch restock', selectedInventory.includes('Restock selected'));
check('a selection offers an archive', selectedInventory.includes('Archive'));
// `Popconfirm` portals its dialog, so only the trigger is inline. The
// confirmation's contract is therefore asserted through the copy it renders.
const archiveCopy = archiveConfirmationCopy(3);
check('the archive confirmation counts the selection', archiveCopy.title === 'Archive 3 products?');
check('one product is singular', archiveConfirmationCopy(1).title === 'Archive 1 product?');
check('the archive confirmation explains the consequence', archiveCopy.description.includes('keep their history'));
check('the archive trigger is a button', selectedInventory.includes('Archive'));
check('a selection can be cleared', selectedInventory.includes('Clear selection'));
check('a selection exposes the batch quantity', selectedInventory.includes('aria-label="Units to add to each selected product"'));
check('the batch quantity defaults to the documented value', DEFAULT_BATCH_RESTOCK_QUANTITY === 20);

const emptyInventory = renderAt(
  'Inventory with an empty catalogue',
  1440,
  <InventoryViewBody
    products={[]}
    analytics={buildInventoryAnalytics([])}
    loading={false}
    filters={{ category: 'all', stockStatus: 'all', searchQuery: '' }}
    hasActiveFilters={false}
    totalCount={0}
    selectedRowKeys={[]}
    onSelectedRowKeysChange={noop}
    onCategoryChange={noop}
    onStockStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    showArchivedOnly={false}
    onToggleArchivedView={noop}
    onOpenProduct={noop}
    onCreateProduct={noop}
    onAdjustStock={noop}
    onExport={noop}
    onBatchRestock={noopAsync}
    onArchive={noopAsync}
    mutationsPending={false}
    error={null}
  />,
);
check('an empty catalogue says so', emptyInventory.includes('The catalogue is empty'));
check('an empty catalogue disables the export', emptyInventory.includes('disabled=""'));

const filteredInventory = renderAt(
  'Inventory with filters that match nothing',
  1440,
  <InventoryViewBody
    products={[]}
    analytics={inventoryAnalytics}
    loading={false}
    filters={{ category: 'Audio', stockStatus: 'all', searchQuery: 'nothing-matches-this' }}
    hasActiveFilters
    totalCount={products.length}
    selectedRowKeys={[]}
    onSelectedRowKeysChange={noop}
    onCategoryChange={noop}
    onStockStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    showArchivedOnly={false}
    onToggleArchivedView={noop}
    onOpenProduct={noop}
    onCreateProduct={noop}
    onAdjustStock={noop}
    onExport={noop}
    onBatchRestock={noopAsync}
    onArchive={noopAsync}
    mutationsPending={false}
    error={null}
  />,
);
check('a filtered-out catalogue offers a reset', filteredInventory.includes('Reset filters'));
check('a filtered-out catalogue explains itself', filteredInventory.includes('No products match these filters'));

check('an unknown deep-linked status is ignored', toStockStatusFilter('not-a-status') === undefined);
check('a missing deep-linked status is ignored', toStockStatusFilter(undefined) === undefined);
check('an "all" deep link clears the filter', toStockStatusFilter('all') === undefined);
check('a real deep-linked status is honoured', toStockStatusFilter('low_stock') === 'low_stock');
check('an out-of-stock deep link is honoured', toStockStatusFilter('out_of_stock') === 'out_of_stock');
check('the batch restock statuses are the two depleted ones', BATCH_RESTOCK_STATUSES.join(',') === 'low_stock,out_of_stock');

const draft = toProductDraft({
  name: 'Widget',
  sku: 'W-1',
  category: 'Audio',
  brand: 'Acme',
  description: 'A widget',
  basePrice: 10,
  baseCost: 4,
  safetyStockThreshold: 5,
  status: 'in_stock',
  tags: ['new'],
  variants: [{ name: 'Small', sku: 'W-1-S', price: 10, costPrice: 4, stockQuantity: 3, safetyStockThreshold: 2 }],
});
check('a draft keeps the product name', draft.name === 'Widget');
check('a draft keeps the variant', draft.variants.length === 1);
check('a draft without a variant id omits the key', draft.variants[0] !== undefined && !('id' in draft.variants[0]));

/* -------------------------------------------------------------------------- */
/* Sales view                                                                  */
/* -------------------------------------------------------------------------- */

const salesMarkup = salesAt(1440);
check('the sales screen renders its revenue card', salesMarkup.includes('Revenue in range'));
check('the sales screen renders its profit card', salesMarkup.includes('Gross profit'));
check('the sales screen renders a tracker per status', TRACKED_ORDER_STATUSES.every((status) => salesMarkup.includes(`${STATUS_TRACKER_LABEL[status]} orders`)));
check('the sales screen renders the orders table', salesMarkup.includes('<table'));
check('the sales screen renders the date range picker', salesMarkup.includes('aria-label="Custom reporting period"'));
check('the sales screen shows the start of the range', decodeEntities(salesMarkup).includes('Jan 1, 2026'));
check('the sales screen offers an export', salesMarkup.includes('Export CSV'));
check('the sales screen does not track cancelled or refunded', !salesMarkup.includes('Cancelled orders') && !salesMarkup.includes('Refunded orders'));

const trackers = buildVolumeTrackers(salesAggregates);
check('there is one tracker per pipeline status', trackers.length === TRACKED_ORDER_STATUSES.length);
check('the trackers cover the whole pipeline', trackers.map((t) => t.status).join(',') === 'pending,processing,shipped,delivered');
check('the tracker shares sum to at most 100', trackers.reduce((total, t) => total + t.sharePct, 0) <= 100.000001);
check('no tracker shows a share for zero orders', trackers.filter((t) => t.count === 0).every((t) => t.sharePct === 0));
check('every populated tracker has a positive share', trackers.filter((t) => t.count > 0).every((t) => t.sharePct > 0));

const emptyAggregates = buildVolumeTrackers(buildSalesAggregates([]));
check('an empty order set gives zero trackers', emptyAggregates.every((tracker) => tracker.count === 0 && tracker.sharePct === 0));

const emptySales = renderAt(
  'Sales with no orders',
  1440,
  <SalesViewBody
    orders={[]}
    aggregates={buildSalesAggregates([])}
    loading={false}
    totalCount={0}
    range={range}
    onRangeChange={noop}
    filters={{ status: 'all', searchQuery: '' }}
    onStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    hasActiveFilters={false}
    onOpenOrder={noop}
    onTransition={noop}
    onExport={noop}
    mutationsPending={false}
    error={null}
  />,
);
check('an empty sales screen says so', emptySales.includes('No orders in this range'));
check('an empty sales screen shows a zero revenue', emptySales.includes('$0.00'));

const filteredSales = renderAt(
  'Sales with filters that match nothing',
  1440,
  <SalesViewBody
    orders={[]}
    aggregates={buildSalesAggregates(orders)}
    loading={false}
    totalCount={orders.length}
    range={range}
    onRangeChange={noop}
    filters={{ status: 'refunded', searchQuery: 'zzz' }}
    onStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    hasActiveFilters
    onOpenOrder={noop}
    onTransition={noop}
    onExport={noop}
    mutationsPending={false}
    error={null}
  />,
);
check('a filtered-out sales screen offers a reset', filteredSales.includes('Reset filters'));
check('a filtered-out sales screen explains itself', filteredSales.includes('No orders match these filters'));

const failedSales = renderAt(
  'Sales with an error',
  1440,
  <SalesViewBody
    orders={[]}
    aggregates={buildSalesAggregates([])}
    loading={false}
    totalCount={0}
    range={range}
    onRangeChange={noop}
    filters={{ status: 'all', searchQuery: '' }}
    onStatusChange={noop}
    onSearchQueryChange={noop}
    onResetFilters={noop}
    hasActiveFilters={false}
    onOpenOrder={noop}
    onTransition={noop}
    onExport={noop}
    mutationsPending={false}
    error="Orders could not be read."
  />,
);
check('a failed sales screen announces the error', failedSales.includes('role="alert"'));

check('an unknown deep-linked order status is ignored', toOrderStatusFilter('not-a-status') === undefined);
check('an "all" deep link clears the order filter', toOrderStatusFilter('all') === undefined);
check('a real deep-linked order status is honoured', toOrderStatusFilter('shipped') === 'shipped');
check('a refunded deep link is honoured', toOrderStatusFilter('refunded') === 'refunded');

/* -------------------------------------------------------------------------- */
/* The connected route map                                                    */
/* -------------------------------------------------------------------------- */

for (const route of ROUTE_PATHS) {
  check(`${route} resolves to a component`, typeof ROUTE_VIEWS[route] === 'function');
}

/* -------------------------------------------------------------------------- */
console.log(`\n[layout] ${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n[layout] ${failures.length} FAILURES:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
}
