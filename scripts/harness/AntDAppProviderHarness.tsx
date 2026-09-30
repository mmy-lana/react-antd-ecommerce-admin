/**
 * Wraps render trees in the providers the app supplies at runtime.
 *
 * Ant Design's `App` component must sit above any consumer of `message`,
 * `modal` and `notification`. Rendering a component that reads those hooks
 * without it throws, so every harness render goes through here — the harness
 * then matches production's provider depth exactly.
 */
import { App as AntdApp, ConfigProvider } from 'antd';
import type { ReactElement, ReactNode } from 'react';

import { themeConfig } from '../../src/app/theme/themeConfig';

export const AntDAppProviderHarness = (children: ReactNode): ReactElement => (
  <ConfigProvider theme={themeConfig}>
    <AntdApp>{children}</AntdApp>
  </ConfigProvider>
);
