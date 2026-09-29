import React from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import { themeConfig } from './theme/themeConfig';
import { Router } from './Router';

export const App: React.FC = () => {
  return (
    <ConfigProvider theme={themeConfig}>
      <AntdApp>
        <Router />
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
