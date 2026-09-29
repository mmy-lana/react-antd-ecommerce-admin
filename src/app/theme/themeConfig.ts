import type { ThemeConfig } from 'antd';
import { colorTokens } from './tokens';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: colorTokens.primary,
    colorSuccess: colorTokens.success,
    colorWarning: colorTokens.warning,
    colorError: colorTokens.error,
    colorInfo: colorTokens.info,
    colorBgBase: colorTokens.cardBackground,
    colorTextBase: colorTokens.textPrimary,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    borderRadius: 8,
    wireframe: false,
  },
  components: {
    Layout: {
      bodyBg: '#f8fafc',
      headerBg: '#ffffff',
      siderBg: '#0f172a',
    },
    Card: {
      colorBgContainer: '#ffffff',
      colorBorderSecondary: '#e2e8f0',
    },
    Table: {
      headerBg: '#f1f5f9',
      headerColor: '#334155',
      rowHoverBg: '#f8fafc',
    },
  },
};
