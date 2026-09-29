import React, { createContext, useContext, useEffect, useState } from 'react';

export type RoutePath = 'dashboard' | 'inventory' | 'sales';

interface RouterContextType {
  currentRoute: RoutePath;
  navigate: (route: RoutePath) => void;
}

const RouterContext = createContext<RouterContextType>({
  currentRoute: 'dashboard',
  navigate: () => {},
});

export const useRouter = (): RouterContextType => useContext(RouterContext);

export const Router: React.FC = () => {
  const getRouteFromHash = (): RoutePath => {
    const hash = window.location.hash.replace('#/', '');
    if (hash === 'inventory' || hash === 'sales') {
      return hash;
    }
    return 'dashboard';
  };

  const [currentRoute, setCurrentRoute] = useState<RoutePath>(getRouteFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (route: RoutePath) => {
    window.location.hash = `#/${route}`;
    setCurrentRoute(route);
  };

  return (
    <RouterContext.Provider value={{ currentRoute, navigate }}>
      <div id="app-viewport-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {currentRoute === 'dashboard' && <div id="dashboard-view-placeholder" />}
          {currentRoute === 'inventory' && <div id="inventory-view-placeholder" />}
          {currentRoute === 'sales' && <div id="sales-view-placeholder" />}
        </main>
      </div>
    </RouterContext.Provider>
  );
};
