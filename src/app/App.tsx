import { Suspense, lazy, useCallback, useEffect, useState, type FC, type ReactNode } from 'react';
import { App as AntdApp, Button, ConfigProvider, Result, Space, Spin, Typography } from 'antd';

import { Router, type RoutePath } from './Router';
import { themeConfig } from './theme/themeConfig';
import { clearAllTables, databaseReady } from '../shared/db/dexieDb';
import { seedDatabaseIfEmpty } from '../shared/db/seedData';
import { ErrorBoundary } from '../shared/components/feedback/ErrorBoundary';
import { colorTokens, fontTokens, layoutTokens } from './theme/tokens';
import { useInventory } from '../features/inventory/hooks/useInventory';
import { DashboardLayout } from '../shared/components/layout/DashboardLayout';

type DatabasePhase = 'opening' | 'seeding' | 'ready' | 'failed';

/**
 * Screens are split per route.
 *
 * The dashboard alone pulls in `@ant-design/plots` and G2, which together are
 * larger than the rest of the app; the two tables are smaller but still not part
 * of the first paint. Loading each on navigation keeps the initial bundle to the
 * shell and the shared component library.
 */
const DashboardView = lazy(async () => ({ default: (await import('../features/dashboard/views/DashboardView')).DashboardView }));
const InventoryView = lazy(async () => ({ default: (await import('../features/inventory/views/InventoryView')).InventoryView }));
const SalesView = lazy(async () => ({ default: (await import('../features/sales/views/SalesView')).SalesView }));

/**
 * The one place a route becomes a screen.
 *
 * Exported as a map rather than a `<Switch>` so the router stays unaware of the
 * features and the verification suite can assert the mapping without mounting
 * three database-backed views.
 */
export const ROUTE_VIEWS: Record<RoutePath, () => ReactNode> = {
  dashboard: () => (
    <Suspense fallback={<RouteFallback label="Loading the dashboard…" />}>
      <DashboardView />
    </Suspense>
  ),
  inventory: () => (
    <Suspense fallback={<RouteFallback label="Loading inventory…" />}>
      <InventoryView />
    </Suspense>
  ),
  sales: () => (
    <Suspense fallback={<RouteFallback label="Loading sales…" />}>
      <SalesView />
    </Suspense>
  ),
};

/** The wrapped screen for a route: the dashboard shell around the feature view. */
export const renderRouteView = (route: RoutePath): ReactNode => <WorkspaceLayout>{ROUTE_VIEWS[route]()}</WorkspaceLayout>;

const BOOT_COPY: Record<Exclude<DatabasePhase, 'ready' | 'failed'>, string> = {
  opening: 'Opening the local workspace…',
  seeding: 'Preparing demo catalog and sales history…',
};

/**
 * Placeholder for a screen whose chunk is still in flight.
 *
 * Announced rather than merely drawn, so a screen-reader user hears the swap
 * instead of landing on silence.
 */
const RouteFallback: FC<{ label: string }> = ({ label }) => (
  <div
    role="status"
    aria-live="polite"
    style={{ display: 'flex', minHeight: 320, alignItems: 'center', justifyContent: 'center' }}
  >
    <Spin size="large" />
    <Typography.Text style={{ marginInlineStart: 12 }}>{label}</Typography.Text>
  </div>
);

/**
 * Restores the demo workspace to a known-good state.
 *
 * A corrupted or schema-drifted IndexedDB is the one failure a plain remount
 * cannot fix, so the fallback offers this alongside a reload. Exported for the
 * verification suite, which drives it directly.
 */
export const resetDemoData = async (): Promise<void> => {
  await clearAllTables();
  await seedDatabaseIfEmpty();
};

/**
 * Workspace-level error boundary.
 *
 * Sits outside {@link WorkspaceLayout} so the header counters and the navigation
 * rail cannot themselves take the app down, and outside the router so a failure
 * in one screen still leaves the other two reachable. Both recovery paths are
 * offered because they fail differently: reload clears a transient fault, reset
 * clears a persisted one.
 */
const WorkspaceErrorBoundary: FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    label="Commerce Admin Workspace"
    fallback={(error, reset) => (
      <div
        role="alert"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 24,
        }}
      >
        <Result
          status="error"
          title="The workspace hit an unexpected error"
          subTitle={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Typography.Text type="secondary">
                Nothing was lost. Reload to retry, or reset the demo data if the problem
                persists in this browser.
              </Typography.Text>
              <Typography.Text
                code
                style={{
                  color: colorTokens.textTertiary,
                  fontSize: fontTokens.fontSizeTiny,
                  maxWidth: 560,
                  overflowWrap: 'anywhere',
                  textAlign: 'left',
                }}
              >
                {error.message}
              </Typography.Text>
            </div>
          }
          extra={
            <Space.Compact>
              <Button type="primary" onClick={reset} style={{ minHeight: layoutTokens.touchTargetMinSize }}>
                Reload Workspace
              </Button>
              <Button
                danger
                onClick={() => {
                  void resetDemoData().then(() => window.location.reload());
                }}
                style={{ minHeight: layoutTokens.touchTargetMinSize }}
              >
                Reset Demo Data
              </Button>
            </Space.Compact>
          }
        />
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

/**
 * The shell, plus the workspace counters the header badge shows.
 *
 * Kept separate from {@link AppShell} so the boot sequence has no live
 * subscription: the badge's query only mounts once the database is ready.
 */
const WorkspaceLayout: FC<{ children: ReactNode }> = ({ children }) => {
  const { analytics, totalCount } = useInventory();

  const alerts = analytics.lowStockCount + analytics.outOfStockCount;

  return (
    <DashboardLayout
      summary={{
        products: totalCount,
        alerts,
      }}
    >
      {children}
    </DashboardLayout>
  );
};

/**
 * Runs the offline-first boot sequence before any view mounts.
 *
 * The database is opened and (on a first visit) seeded here so every downstream
 * `useLiveQuery` subscription can assume a live, non-empty store. Failures are
 * surfaced as a retryable error state instead of an unhandled rejection.
 */
const AppShell: FC = () => {
  const { message } = AntdApp.useApp();
  const [phase, setPhase] = useState<DatabasePhase>('opening');
  const [failureMessage, setFailureMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      try {
        await databaseReady;
        if (cancelled) return;

        setPhase('seeding');
        const summary = await seedDatabaseIfEmpty();
        if (cancelled) return;

        if (summary) {
          message.success(
            `Workspace ready — ${summary.products} products, ${summary.orders} orders, ${summary.inventoryLogs} stock movements.`,
          );
        }
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        setFailureMessage(
          error instanceof Error
            ? error.message
            : 'IndexedDB could not be opened in this browser context.',
        );
        setPhase('failed');
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [attempt, message]);

  const retry = useCallback(() => {
    setFailureMessage('');
    setAttempt((value) => value + 1);
  }, []);

  if (phase === 'failed') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 24,
        }}
      >
        <Result
          status="error"
          title="Local workspace unavailable"
          subTitle={failureMessage}
          extra={
            <Button type="primary" onClick={retry}>
              Retry initialization
            </Button>
          }
        />
      </div>
    );
  }

  if (phase !== 'ready') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          minHeight: '100vh',
          padding: 24,
        }}
      >
        <Spin size="large" />
        <Typography.Text type="secondary">{BOOT_COPY[phase]}</Typography.Text>
      </div>
    );
  }

  return (
    <WorkspaceErrorBoundary>
      <Router renderView={renderRouteView} />
    </WorkspaceErrorBoundary>
  );
};

/**
 * Root composition: theme tokens → Ant Design context holder → application.
 *
 * `AntdApp` must sit above every consumer so `modal`, `message` and
 * `notification` resolve through React context. The static `antd` variants of
 * those APIs are removed in Ant Design 6 and are never used in this codebase.
 */
export const App: FC = () => (
  <ConfigProvider theme={themeConfig}>
    <AntdApp>
      <AppShell />
    </AntdApp>
  </ConfigProvider>
);

export default App;
