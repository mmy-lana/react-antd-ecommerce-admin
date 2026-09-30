/**
 * Route-level error boundary.
 *
 * A render failure inside one view must not blank the entire console — the user
 * still needs the navigation rail to escape. Wrapping each routed view in a
 * boundary turns "white screen" into a recoverable, explainable state.
 *
 * Errors are also re-thrown to `window.onerror` reporting paths via the
 * optional `onError` callback so the shell can log them.
 */

import { Button, Result, Typography } from 'antd';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Region name shown in the fallback, e.g. `Inventory`. */
  label?: string;
  /** Invoked once per caught error, before the fallback renders. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Incremented on reset to remount the subtree even if the error persists. */
  resetKey: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    // Keep the stack reachable in the console even when the UI swallows it.
    console.error(`[${this.props.label ?? 'app'}] render failure`, error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState((previous) => ({ error: null, resetKey: previous.resetKey + 1 }));
  };

  override render(): ReactNode {
    const { error, resetKey } = this.state;
    const { children, fallback, label = 'This section' } = this.props;

    if (!error) {
      // `resetKey` participates in the identity of the subtree so a reset after
      // a persistent error still remounts cleanly.
      return <div key={resetKey} style={{ display: 'contents' }}>{children}</div>;
    }

    if (fallback) return fallback(error, this.handleReset);

    return (
      <Result
        status="error"
        title={`${label} could not be displayed`}
        subTitle={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <Typography.Text style={{ color: colorTokens.textSecondary }}>
              An unexpected error interrupted this view. The rest of the console is still available.
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
        extra={[
          <Button key="retry" type="primary" onClick={this.handleReset}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}>
            Try again
          </Button>,
          <Button key="reload" onClick={() => window.location.reload()}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}>
            Reload workspace
          </Button>,
        ]}
      />
    );
  }
}

export default ErrorBoundary;
