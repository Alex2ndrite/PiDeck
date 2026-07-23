import { type PointerEvent, type ReactNode, type CSSProperties } from "react";
import { AppHeader } from "../AppHeader";
import { WorkspaceDrawerHost } from "../workspace/WorkspaceDrawerHost";
import type { WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";

export interface AppShellProps {
  listCollapsed: boolean;
  listWidth: number;
  listHoverRevealSuppressed: boolean;
  drawer: WorkspaceDrawerPanel | null;
  drawerCollapsed: boolean;
  drawerWidth: number;
  drawerPinned: boolean;
  useNativeTitleBar: boolean;

  chatPaneRef: React.RefObject<HTMLElement | null>;
  terminalRowHeight: number;
  contentMaxWidth: number;

  sidebarContent: ReactNode;
  chatPaneContent: ReactNode;
  drawerContent: ReactNode;
  outlineContent: ReactNode;

  onResize: (target: "list" | "drawer", event: PointerEvent) => void;
  onToggleListCollapsed: () => void;
  onReleaseListHoverSuppression: (event: PointerEvent<HTMLDivElement>) => void;
  onDrawerCollapse: () => void;
  onDrawerClose: () => void;
  onDrawerRestore: () => void;
  onToggleDrawerPin: () => void;

  toggleAlwaysOnTop: () => Promise<boolean>;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;

  children?: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const {
    listCollapsed, listWidth, listHoverRevealSuppressed,
    drawer, drawerCollapsed, drawerWidth, drawerPinned,
    useNativeTitleBar,
    chatPaneRef, terminalRowHeight, contentMaxWidth,
    sidebarContent, chatPaneContent, drawerContent, outlineContent,
    onResize, onToggleListCollapsed, onReleaseListHoverSuppression,
    onDrawerCollapse, onDrawerClose, onDrawerRestore, onToggleDrawerPin,
    toggleAlwaysOnTop, minimizeWindow, toggleMaximizeWindow, closeWindow,
    children,
  } = props;

  function startResize(target: "list" | "drawer", event: PointerEvent) {
    onResize(target, event);
  }

  function handleToggleListCollapsed() {
    onToggleListCollapsed();
  }

  function handleReleaseListHoverSuppression(event: PointerEvent<HTMLDivElement>) {
    onReleaseListHoverSuppression(event);
  }

  return (
    <div
      className={[
        "wechat-shell",
        drawer ? "drawer-open" : "",
        listCollapsed ? "list-collapsed" : "",
        listHoverRevealSuppressed ? "list-hover-suppressed" : "",
        drawerCollapsed ? "drawer-collapsed" : "",
        useNativeTitleBar ? "" : "custom-titlebar-enabled",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerMove={handleReleaseListHoverSuppression}
      style={
        {
          "--list-width": `${listCollapsed ? 0 : listWidth}px`,
          "--list-expanded-width": `${listWidth}px`,
          "--list-hover-width": `${Math.max(190, listWidth)}px`,
          "--drawer-width": `${drawer && !drawerCollapsed ? drawerWidth : 0}px`,
          "--drawer-col-w": `${drawer && !drawerCollapsed ? 260 : 0}px`,
          "--drawer-splitter-w": `${drawer && !drawerCollapsed ? 6 : 0}px`,
        } as CSSProperties
      }
    >
      <AppHeader
        useNativeTitleBar={useNativeTitleBar}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
        minimizeWindow={minimizeWindow}
        toggleMaximizeWindow={toggleMaximizeWindow}
        closeWindow={closeWindow}
      />
      {sidebarContent}
      <div
        className="splitter splitter-left"
        onPointerDown={(event) => startResize("list", event)}
      />

      <main
        ref={chatPaneRef}
        className="chat-pane"
        style={{
          "--terminal-row-h": `${terminalRowHeight}px`,
          ...(contentMaxWidth > 0 && contentMaxWidth < 1400
            ? { "--content-max-width": `${contentMaxWidth}px` }
            : undefined),
        } as CSSProperties}
      >
        {chatPaneContent}
      </main>

      {outlineContent}

      {/* 右侧分隔条常驻 grid 列 4，宽度由 --drawer-splitter-w 驱动（0/6px）；
          关闭/折叠时宽度 0 且 pointer-events:none，避免遮挡会话区。 */}
      <div
        className="splitter splitter-right"
        data-active={drawer && !drawerCollapsed}
        onPointerDown={(event) =>
          drawer && !drawerCollapsed && startResize("drawer", event)
        }
      />
      <WorkspaceDrawerHost
        panel={drawer}
        collapsed={drawerCollapsed}
        pinned={drawerPinned}
        onCollapse={onDrawerCollapse}
        onClose={onDrawerClose}
        onRestore={onDrawerRestore}
        onTogglePin={onToggleDrawerPin}
        renderPanel={() => <>{drawerContent}</>}
      />
      {children}
    </div>
  );
}
