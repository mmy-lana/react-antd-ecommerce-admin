/**
 * Responsive layout primitives (plan §2.4).
 *
 * Three width bands drive every layout decision in the app:
 *
 *  | band      | width      | navigation            | tables                |
 *  |-----------|------------|-----------------------|-----------------------|
 *  | compact   | < 480px    | slide-over drawer     | 4 core columns        |
 *  | tablet    | 480-767px  | slide-over drawer     | full column set       |
 *  | desktop   | >= 768px   | fixed collapsible bar | full column set       |
 *
 * The breakpoint values live in `layoutTokens` so the contract in the plan and
 * the code cannot drift apart.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from 'react';

import { layoutTokens } from '../../../app/theme/tokens';

export type Breakpoint = 'compact' | 'tablet' | 'desktop';

export interface ViewportSize {
  width: number;
  height: number;
}

/** Width assumed before the first measurement (avoids a desktop-to-mobile flash). */
const FALLBACK_VIEWPORT_WIDTH = 1024;

export const resolveBreakpoint = (width: number): Breakpoint => {
  if (width < layoutTokens.compactBreakpoint) return 'compact';
  if (width < layoutTokens.mobileBreakpoint) return 'tablet';
  return 'desktop';
};

const readViewport = (): ViewportSize => {
  if (typeof window === 'undefined') {
    return { width: FALLBACK_VIEWPORT_WIDTH, height: 768 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
};

/**
 * Subscribes to viewport resizes.
 *
 * Reads `window.innerWidth` rather than a `matchMedia` query because the layout
 * also needs the exact pixel width to size overlay content, and a media query
 * only reports which band was crossed.
 */
export const useViewportSize = (): ViewportSize => {
  const [viewport, setViewport] = useState<ViewportSize>(readViewport);

  useEffect(() => {
    let frame = 0;

    const handleResize = (): void => {
      // Coalesce bursts of resize events into one state write per frame.
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setViewport((previous) => {
          const next = readViewport();
          return previous.width === next.width && previous.height === next.height
            ? previous
            : next;
        });
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Re-measure immediately: the listener is attached after the first render,
    // and the viewport can change between those two points.
    handleResize();

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return viewport;
};

export const useBreakpoint = (): Breakpoint => {
  const { width } = useViewportSize();
  return useMemo(() => resolveBreakpoint(width), [width]);
};

/** True below the 768px navigation breakpoint. */
export const useIsMobile = (): boolean => useBreakpoint() !== 'desktop';

/** True below the 480px width where overlays go full-bleed. */
export const useIsCompact = (): boolean => useBreakpoint() === 'compact';

export type OverlayWidth = number | '100%';

/**
 * Overlay sizing rule from the plan: `width={viewportWidth < 480 ? '100%' : 460}`.
 *
 * `baseWidth` defaults to `layoutTokens.drawerWidth`; views with denser content
 * (the order detail drawer) pass a wider base.
 */
export const useOverlayWidth = (baseWidth: number = layoutTokens.drawerWidth): OverlayWidth =>
  useIsCompact() ? '100%' : baseWidth;

/* -------------------------------------------------------------------------- */
/* Container                                                                   */
/* -------------------------------------------------------------------------- */

export interface ResponsiveContainerProps {
  children: ReactNode;
  /** Semantic element rendered as the outer node. Defaults to `div`. */
  as?: 'div' | 'section' | 'main' | 'article' | 'aside';
  /** Adds the gutter-consistent horizontal padding for the current band. */
  padded?: boolean;
  /** Caps content width on ultra-wide displays. */
  constrainWidth?: boolean;
  /** Applied to the outer node, after the container's own classes. */
  className?: string;
  style?: CSSProperties;
}

/**
 * Width-band aware layout wrapper.
 *
 * Publishes the active band as `data-breakpoint` so stylesheets and end-to-end
 * tests can assert layout state without reaching into React state.
 */
export const ResponsiveContainer: FC<ResponsiveContainerProps> = ({
  children,
  as = 'div',
  padded = true,
  constrainWidth = true,
  className,
  style,
}) => {
  const breakpoint = useBreakpoint();

  const padding = padded
    ? breakpoint === 'compact'
      ? layoutTokens.contentPaddingCompact
      : layoutTokens.contentPadding
    : 0;

  const resolvedClassName = ['responsive-container', className].filter(Boolean).join(' ');

  const resolvedStyle: CSSProperties = {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    paddingInline: padding,
    ...(constrainWidth ? { maxWidth: layoutTokens.contentMaxWidth } : {}),
    ...style,
  };

  const sharedProps = { className: resolvedClassName, 'data-breakpoint': breakpoint, style: resolvedStyle };

  if (as === 'main') return <main {...sharedProps}>{children}</main>;
  if (as === 'section') return <section {...sharedProps}>{children}</section>;
  if (as === 'article') return <article {...sharedProps}>{children}</article>;
  if (as === 'aside') return <aside {...sharedProps}>{children}</aside>;
  return <div {...sharedProps}>{children}</div>;
};

/* -------------------------------------------------------------------------- */
/* Touch target helper                                                         */
/* -------------------------------------------------------------------------- */

const COARSE_POINTER_QUERY = '(pointer: coarse)';

const prefersCoarsePointer = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
};

/**
 * Minimum hit box for every interactive control (WCAG 2.5.8 / plan §2.4).
 *
 * Pointer-precise devices keep a tighter desktop hit box; touch devices get the
 * full 44px target. The result is a style object so it can be spread onto any
 * Ant Design component, including ones that only forward `style`.
 */
export const useTouchTargetStyle = (
  size: number = layoutTokens.touchTargetMinSize,
): { style: CSSProperties } => {
  const { width } = useViewportSize();

  return useMemo(() => {
    const target = prefersCoarsePointer() ? size : Math.min(size, 36);
    return {
      style: {
        minWidth: target,
        minHeight: target,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      } satisfies CSSProperties,
    };
  }, [size, width]);
};

/* -------------------------------------------------------------------------- */
/* Element size observation (Task 3.3 chart requirement)                      */
/* -------------------------------------------------------------------------- */

export interface ObservedSize {
  width: number;
  height: number;
}

/**
 * Reports the content box of a node via `ResizeObserver`.
 *
 * Charts render into a canvas and cannot self-size, so they need the observed
 * pixel width to choose tick density and legend wrapping. Falls back to the
 * window viewport when `ResizeObserver` is unavailable.
 */
export const useElementSize = <T extends HTMLElement>(): [
  (node: T | null) => void,
  ObservedSize,
] => {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<ObservedSize>(() => {
    const { width, height } = readViewport();
    return { width, height };
  });

  const ref = useCallback((next: T | null) => setNode(next), []);

  useEffect(() => {
    if (!node) return;

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = (): void => setSize(readViewport());
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
          ? previous
          : { width, height },
      );
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, size];
};
