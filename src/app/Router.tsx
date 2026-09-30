/**
 * Hash-based routing (plan §2.6).
 *
 * The console ships as a static bundle with no server rewrite rules, so
 * navigation uses the URL fragment. That keeps deep links, the browser back
 * button and refresh-survives-reload working with no hosting assumptions.
 *
 * Route parsing is a pure function so it can be asserted directly rather than
 * through a simulated history event.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FC,
  type ReactNode,
} from 'react';

export const ROUTE_PATHS = ['dashboard', 'inventory', 'sales'] as const;
export type RoutePath = (typeof ROUTE_PATHS)[number];

export const DEFAULT_ROUTE: RoutePath = 'dashboard';

/** Document title per route, so browser history and tabs stay distinguishable. */
export const ROUTE_TITLES: Record<RoutePath, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  sales: 'Sales',
};

export const APP_TITLE = 'Commerce Admin';

const HASH_PREFIX = '#/';

export const buildRouteHash = (route: RoutePath): string => `${HASH_PREFIX}${route}`;

/** Splits a hash into its route segment and its query string. */
export const splitRouteHash = (hash: string): { path: string; query: string } => {
  const candidate = hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;
  const [path = '', ...rest] = candidate.replace(/^\/+|\/+$/g, '').split('?');
  return { path, query: rest.join('?') };
};

/** Maps any hash to a known route, falling back to the dashboard. */
export const parseRouteFromHash = (hash: string): RoutePath => {
  const { path } = splitRouteHash(hash);
  const normalized = path.split('/')[0];
  return (ROUTE_PATHS as readonly string[]).includes(normalized)
    ? (normalized as RoutePath)
    : DEFAULT_ROUTE;
};

/**
 * Parses a route query string into key/value pairs.
 *
 * A view can therefore be deep-linked (`#/inventory?status=low_stock`) and a
 * cross-view link can carry a filter without any shared mutable state.
 */
export const parseRouteQuery = (query: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const separator = pair.indexOf('=');
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const value = separator === -1 ? '' : pair.slice(separator + 1);
    if (key === '') continue;
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return params;
};

export const buildRouteHashWithQuery = (route: RoutePath, query?: Record<string, string>): string => {
  if (query === undefined || Object.keys(query).length === 0) return buildRouteHash(route);
  const search = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return search === '' ? buildRouteHash(route) : `${HASH_PREFIX}${route}?${search}`;
};

const readCurrentRoute = (): RoutePath =>
  typeof window === 'undefined' ? DEFAULT_ROUTE : parseRouteFromHash(window.location.hash);

const readCurrentQuery = (): Record<string, string> =>
  typeof window === 'undefined' ? {} : parseRouteQuery(splitRouteHash(window.location.hash).query);

export interface RouterContextValue {
  currentRoute: RoutePath;
  /** Query parameters of the current hash, so views can be deep-linked. */
  query: Record<string, string>;
  navigate: (route: RoutePath, query?: Record<string, string>) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

/**
 * Access the current route. Throws outside a `<Router>` rather than silently
 * falling back to the dashboard, which would hide a broken tree in development.
 */
export const useRouter = (): RouterContextValue => {
  const context = useContext(RouterContext);
  if (context === null) {
    throw new Error('useRouter must be used inside a <Router> provider');
  }
  return context;
};

export interface RouterProps {
  /**
   * Renders the view for a route. Phase 5 supplies the real views; the default
   * renders the route's section landmark so the shell is navigable from the
   * first commit.
   */
  renderView?: (route: RoutePath) => ReactNode;
}

export const Router: FC<RouterProps> = ({ renderView }) => {
  const [currentRoute, setCurrentRoute] = useState<RoutePath>(readCurrentRoute);
  const [query, setQuery] = useState<Record<string, string>>(readCurrentQuery);

  useEffect(() => {
    const handleHashChange = (): void => {
      setCurrentRoute(readCurrentRoute());
      setQuery(readCurrentQuery());
    };
    window.addEventListener('hashchange', handleHashChange);

    // Normalize an unknown or empty fragment so the address bar matches the
    // rendered route without adding a history entry for the correction.
    if (parseRouteFromHash(window.location.hash) !== currentRoute) {
      window.history.replaceState(null, '', buildRouteHash(currentRoute));
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
    // `currentRoute` is intentionally excluded: re-running on navigation would
    // re-write history after every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${ROUTE_TITLES[currentRoute]} · ${APP_TITLE}`;
  }, [currentRoute]);

  const navigate = useCallback((route: RoutePath, nextQuery?: Record<string, string>) => {
    setCurrentRoute((previous) => {
      if (previous === route) return previous;
      window.location.hash = buildRouteHashWithQuery(route, nextQuery);
      return route;
    });
    if (nextQuery !== undefined) setQuery(nextQuery);
  }, []);

  const contextValue = useMemo<RouterContextValue>(
    () => ({ currentRoute, query, navigate }),
    [currentRoute, query, navigate],
  );

  const content = renderView
    ? renderView(currentRoute)
    : (
        <section
          id={`${currentRoute}-view`}
          aria-label={ROUTE_TITLES[currentRoute]}
          style={{ padding: 24 }}
        />
      );

  return (
    <RouterContext.Provider value={contextValue}>
      <div id="app-viewport-root" className="app-viewport">
        <main id="main-content" className="app-content" tabIndex={-1}>
          {content}
        </main>
      </div>
    </RouterContext.Provider>
  );
};

export default Router;
