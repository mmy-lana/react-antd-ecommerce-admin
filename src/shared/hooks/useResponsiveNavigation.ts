/**
 * Responsive navigation state (plan Task 4.5).
 *
 * The shell shows one of two navigation surfaces at any moment:
 *
 *  - **below 768px** — a slide-over drawer, opened and dismissed explicitly;
 *  - **768px and above** — a fixed sidebar that the user can collapse to icons.
 *
 * Two pieces of state that are genuinely different get separate names, because
 * conflating them is how shells end up with a drawer that stays open behind a
 * desktop sidebar:
 *
 *  - `drawerOpen` only means anything on mobile, and is forced closed as soon as
 *    the viewport becomes desktop, so a drawer can never be left stranded;
 *  - `sidebarCollapsed` only means anything on desktop, and survives a trip
 *    through mobile unchanged, so the user's preference is remembered.
 *
 * The breakpoint arithmetic is exported as a pure function so the transition
 * rules can be asserted without a DOM.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useViewportSize } from '../components/primitives/ResponsiveContainer';

/** Width at which the fixed sidebar replaces the slide-over drawer. */
export const NAVIGATION_BREAKPOINT = 768;

/** The resolved navigation mode for a given viewport width. */
export type NavigationMode = 'drawer' | 'sidebar';

export const resolveNavigationMode = (width: number): NavigationMode =>
  width >= NAVIGATION_BREAKPOINT ? 'sidebar' : 'drawer';

export const isDesktopNavigation = (width: number): boolean =>
  resolveNavigationMode(width) === 'sidebar';

export interface ResponsiveNavigation {
  /** What the shell should render right now. */
  mode: NavigationMode;
  isMobile: boolean;
  isDesktop: boolean;
  viewportWidth: number;
  /** Slide-over drawer visibility; always `false` in sidebar mode. */
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** Desktop sidebar state, persisted across mobile trips. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useResponsiveNavigation = (
  options: { defaultSidebarCollapsed?: boolean } = {},
): ResponsiveNavigation => {
  const { defaultSidebarCollapsed = false } = options;
  const { width } = useViewportSize();
  const mode = resolveNavigationMode(width);
  const isMobile = mode === 'drawer';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);

  // Growing past the breakpoint must never leave a drawer stranded off-screen
  // with the page body still scrolled behind it.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((open) => !open), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), []);

  return useMemo<ResponsiveNavigation>(
    () => ({
      mode,
      isMobile,
      isDesktop: !isMobile,
      viewportWidth: width,
      // The mode gate is applied here as well as in the effect, so the very
      // first render at desktop width is already correct.
      drawerOpen: isMobile && drawerOpen,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
    }),
    [mode, isMobile, width, drawerOpen, sidebarCollapsed, openDrawer, closeDrawer, toggleDrawer, toggleSidebar],
  );
};
