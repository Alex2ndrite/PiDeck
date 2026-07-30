import { ChevronLeft } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import {
  DRAWER_ANIMATION_MS,
  type WorkspaceDrawerPanel,
} from "../../hooks/useWorkspacePanels";

export function getVisibleDrawerPanel<T>(
  open: boolean,
  panel: T | null,
  renderedDrawer: T | null,
) {
  return open ? panel : renderedDrawer;
}

export type WorkspaceDrawerHostProps = {
  panel: WorkspaceDrawerPanel | null;
  collapsed: boolean;
  pinned?: boolean;
  className?: string;
  style?: CSSProperties;
  onCollapse?: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onTogglePin?: () => void;
  renderPanel: (panel: WorkspaceDrawerPanel) => ReactNode;
};

/**
 * Keeps the drawer compositor mounted while the grid column closes. The 120ms
 * delay is part of the layout contract: removing content before the grid motion
 * completes makes text disappear before the drawer itself reaches zero width.
 */
export function WorkspaceDrawerHost(props: WorkspaceDrawerHostProps) {
  const [renderedDrawer, setRenderedDrawer] = useState<WorkspaceDrawerPanel | null>(props.panel);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (unmountTimerRef.current) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    if (props.panel && !props.collapsed) {
      setRenderedDrawer(props.panel);
      return;
    }
    if (!renderedDrawer) return;
    unmountTimerRef.current = setTimeout(() => {
      setRenderedDrawer(null);
      unmountTimerRef.current = null;
    }, DRAWER_ANIMATION_MS);
    return () => {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
  }, [props.collapsed, props.panel, renderedDrawer]);

  useEffect(() => () => {
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
  }, []);

  const open = Boolean(props.panel && !props.collapsed);
  // A newly opened or switched panel must render synchronously; only a closing
  // compositor uses the previous rendered panel as its delayed fallback.
  const visiblePanel = getVisibleDrawerPanel(open, props.panel, renderedDrawer);
  const rendered = visiblePanel ? props.renderPanel(visiblePanel) : null;
  return (
    <>
      <aside
        className={props.className ?? "detail-drawer"}
        data-open={open}
        data-rendered={Boolean(visiblePanel)}
        data-pinned={Boolean(props.pinned)}
        style={props.style}
      >
        {visiblePanel && <div className="drawer-content-frame">{rendered}</div>}
      </aside>
      {props.panel && props.collapsed && props.onRestore && (
        <button
          type="button"
          className="drawer-restore"
          title={t("drawer.expandPanel")}
          aria-label={t("drawer.expandPanel")}
          onClick={props.onRestore}
        >
          <ChevronLeft size={16} />
        </button>
      )}
    </>
  );
}

export { DRAWER_ANIMATION_MS };
