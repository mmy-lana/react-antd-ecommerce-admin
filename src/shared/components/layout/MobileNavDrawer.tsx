/**
 * Mobile slide-over navigation (plan Tasks 4.5 and 5.1).
 *
 * Below 768px the fixed sidebar is replaced by an Ant Design `Drawer` that
 * slides in from the left. The drawer hosts the same {@link NavItemList} the
 * sidebar uses, so the two can never offer different destinations.
 *
 * `Drawer` renders through a portal, which produces no markup under
 * `renderToStaticMarkup`. The panel content is therefore exported separately as
 * {@link MobileNavBody} so it can be asserted directly, while {@link
 * MobileNavDrawer} stays a thin shell that owns only the open state and width.
 */

import { Drawer, Button, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { APP_TITLE, type RoutePath } from '../../../app/Router';
import { useIsCompact } from '../primitives/ResponsiveContainer';
import { NavItemList, navTargetStyle } from './SidebarNav';

export interface MobileNavBodyProps {
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
  onClose: () => void;
  /** Footer content, e.g. a workspace summary. */
  footer?: ReactNode;
}

/**
 * The drawer's panel content: brand row, navigation list, optional footer.
 *
 * Exported so the suite can render it without a document.
 */
export const MobileNavBody: FC<MobileNavBodyProps> = ({
  currentRoute,
  onNavigate,
  onClose,
  footer,
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: layoutTokens.contentPadding,
      height: '100%',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Typography.Text strong style={{ color: colorTokens.textPrimary }}>
        {APP_TITLE}
      </Typography.Text>
      <Button
        type="text"
        icon={<CloseOutlined />}
        onClick={onClose}
        aria-label="Close navigation"
        style={{ ...navTargetStyle, color: colorTokens.textSecondary }}
      />
    </div>

    <nav aria-label="Primary" style={{ flexShrink: 0 }}>
      <NavItemList
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onNavigateAndClose={onClose}
      />
    </nav>

    {footer === undefined ? null : (
      <div
        style={{
          marginTop: 'auto',
          paddingTop: layoutTokens.contentPadding,
          borderTop: `1px solid ${colorTokens.borderColor}`,
          color: colorTokens.textTertiary,
          fontSize: fontTokens.fontSizeSmall,
        }}
      >
        {footer}
      </div>
    )}
  </div>
);

export interface MobileNavDrawerProps {
  open: boolean;
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
  onClose: () => void;
  footer?: ReactNode;
}

/**
 * The overlay shell.
 *
 * `placement="left"` and `mask={{ closable: false }}` are deliberate: the drawer
 * is the primary navigation below 768px, so tapping the scrim should not
 * dismiss it and lose the user's place. Escape and the close button remain.
 *
 * Two Ant Design 6 API notes, both checked against `Drawer.d.ts`:
 *
 * - `size` carries the panel width; the `width` prop is deprecated in its favour.
 *   It accepts a number or a CSS length, so `320` and `'100%'` are both valid.
 * - `mask={{ closable: false }}` is the *current* spelling. The bare
 *   `maskClosable` prop is the deprecated one — `MaskConfig.closable` is what
 *   `normalizeMaskConfig` reads — so moving to `maskClosable={false}` would
 *   reintroduce the deprecation warning this component avoids.
 */
export const MobileNavDrawer: FC<MobileNavDrawerProps> = ({
  open,
  currentRoute,
  onNavigate,
  onClose,
  footer,
}) => {
  const compact = useIsCompact();
  // Below 480px the drawer is full-bleed, matching every other overlay.
  const width = compact ? '100%' : Math.min(320, layoutTokens.sidebarWidth);

  return (
    <Drawer
      id="mobile-nav-drawer"
      open={open}
      onClose={onClose}
      placement="left"
      size={width}
      mask={{ closable: false }}
      closable={false}
      title={null}
      styles={{ body: { padding: layoutTokens.contentPadding } }}
      aria-label="Primary"
    >
      <MobileNavBody
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onClose={onClose}
        {...(footer === undefined ? {} : { footer })}
      />
    </Drawer>
  );
};

export default MobileNavDrawer;
