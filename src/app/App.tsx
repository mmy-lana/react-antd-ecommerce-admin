import { useCallback, useEffect, useState, type FC } from 'react';
import { App as AntdApp, Button, ConfigProvider, Result, Spin, Typography } from 'antd';

import { Router } from './Router';
import { themeConfig } from './theme/themeConfig';
import { databaseReady } from '../shared/db/dexieDb';
import { seedDatabaseIfEmpty } from '../shared/db/seedData';

type DatabasePhase = 'opening' | 'seeding' | 'ready' | 'failed';

const BOOT_COPY: Record<Exclude<DatabasePhase, 'ready' | 'failed'>, string> = {
  opening: 'Opening the local workspace…',
  seeding: 'Preparing demo catalog and sales history…',
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

  return <Router />;
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
