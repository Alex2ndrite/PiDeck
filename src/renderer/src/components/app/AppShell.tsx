import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import {
  type Layout,
  type LayoutChangedMeta,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui-shadcn/resizable";
import { AppHeader } from "../AppHeader";
import { WorkspaceDrawerHost } from "../workspace/WorkspaceDrawerHost";
import type { WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";

/**
 * 工作台外壳（#115 U5 布局换装）：三栏水平布局由 react-resizable-panels 接管。
 *
 * 状态归属约定：
 * - App 侧的 px 状态（listWidth/drawerWidth/listCollapsed/drawerCollapsed）仍是
 *   单一事实源，同时驱动 CSS 变量（hover 宽度、抽屉内部动画等旧样式仍依赖它们）。
 * - 面板库负责拖拽交互；拖拽**过程中不回写 React 状态**（每个 pointermove 都
 *   setState 会让整个工作台每帧重渲染，且 defaultSize 随动会触发库重布局，
 *   两者叠加就是肉眼可见的抖动）；拖拽释放/键盘调整完成时经 Group 的
 *   onLayoutChanged 统一提交一次。外部状态变化（标题栏折叠按钮、恢复默认宽度）
 *   经 imperative resize/collapse/expand 同步回面板。
 * - 宽度变化超过 1px 才回写/同步，避免 state → resize → layout 的反馈回路。
 *
 * 折叠语义：
 * - 侧栏 collapsedSize=0（完全收起，无残留竖条；恢复入口在会话 Tab 栏左侧）。
 * - 抽屉只有开/关：打开时不可拖成「半折叠」；默认关闭，由用户手动打开。
 *
 * 已知变化：抽屉/侧栏开合不再有 120ms grid 过渡动画（面板布局为即时宽度），
 * 后续视觉收口阶段如需动画再补。
 */

export interface AppShellProps {
  listCollapsed: boolean;
  listWidth: number;
  drawer: WorkspaceDrawerPanel | null;
  drawerCollapsed: boolean;
  drawerWidth: number;
  useNativeTitleBar: boolean;

  chatPaneRef: React.RefObject<HTMLElement | null>;
  terminalRowHeight: number;
  contentMaxWidth: number;

  sidebarContent: ReactNode;
  chatPaneContent: ReactNode;
  drawerContent: (panel: WorkspaceDrawerPanel) => ReactNode;
  /** 抽屉活动栏（files/git/browser 切换），由 App 注入；抽屉打开时常驻。 */
  drawerRail?: ReactNode;
  outlineContent: ReactNode;

  setListCollapsed: (v: boolean) => void;
  setListWidth: (v: number) => void;
  setDrawerCollapsed: (v: boolean) => void;
  setDrawerWidth: (v: number) => void;
  onToggleListCollapsed: () => void;
  onDrawerClose: () => void;


  toggleAlwaysOnTop: () => Promise<boolean>;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  closeWindow: () => void;

  children?: ReactNode;
}

/** 侧栏完全收起：不再留 14px 提示条（会变成难看的空白缝） */
const LIST_COLLAPSED_SIZE = 0;
const LIST_MIN = 100;
const LIST_MAX = 440;
const DRAWER_MIN = 180;
const DRAWER_MAX = 560;

export function AppShell(props: AppShellProps) {
  const {
    listCollapsed, listWidth,
    drawer, drawerCollapsed, drawerWidth,
    useNativeTitleBar,
    chatPaneRef, terminalRowHeight, contentMaxWidth,
    sidebarContent, chatPaneContent, drawerContent, drawerRail, outlineContent,
    setListCollapsed, setListWidth, setDrawerCollapsed, setDrawerWidth,
    onToggleListCollapsed,
    onDrawerClose,
    toggleAlwaysOnTop, minimizeWindow, toggleMaximizeWindow, closeWindow,
    isWindowMaximized, onWindowMaximizedChange,
    children,
  } = props;

  const listPanelRef = useRef<PanelImperativeHandle | null>(null);
  const drawerPanelRef = useRef<PanelImperativeHandle | null>(null);

  // ── 折叠状态 → 面板（标题栏按钮、抽屉头部按钮等外部来源） ──
  useEffect(() => {
    const panel = listPanelRef.current;
    if (!panel) return;
    if (listCollapsed) {
      if (!panel.isCollapsed()) panel.collapse();
      return;
    }
    // collapsedSize=0 时仅 expand() 偶发不回弹；显式 resize 到记忆宽度更稳。
    try {
      if (panel.isCollapsed()) panel.expand();
      if (Math.abs(panel.getSize().inPixels - listWidth) > 1) panel.resize(listWidth);
    } catch { /* 约束未就绪 */ }
  }, [listCollapsed, listWidth]);

  // 抽屉 Panel 常驻挂载（drawer=null 时折叠 0 宽），此 effect 统一同步折叠态；
  // 推迟一帧 + 容错：常驻挂载后约束始终就绪，保留 try/catch 仅为防御。
  useEffect(() => {
    const panel = drawerPanelRef.current;
    if (!panel) return;
    const frame = requestAnimationFrame(() => {
      try {
        // drawer 为空时必须折叠（常驻挂载下避免空面板意外展开）
        if (!drawer || drawerCollapsed) {
          if (!panel.isCollapsed()) panel.collapse();
        } else if (panel.isCollapsed()) panel.expand();
      } catch { /* 约束未就绪，忽略本轮同步 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [drawerCollapsed, drawer]);

  // ── 外部宽度变化 → 面板（跳过拖拽回写产生的等值同步，防反馈回路） ──
  useEffect(() => {
    const panel = listPanelRef.current;
    if (!panel || listCollapsed) return;
    if (Math.abs(panel.getSize().inPixels - listWidth) > 1) panel.resize(listWidth);
  }, [listWidth, listCollapsed]);

  useEffect(() => {
    const panel = drawerPanelRef.current;
    if (!panel || !drawer || drawerCollapsed) return;
    const frame = requestAnimationFrame(() => {
      try {
        if (Math.abs(panel.getSize().inPixels - drawerWidth) > 1) panel.resize(drawerWidth);
      } catch { /* 约束未就绪 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [drawerWidth, drawer, drawerCollapsed]);

  // ── 拖拽完成 → px/折叠状态统一回写 ──
  // onLayoutChanged 在一次布局变更“完成”时触发（拖拽释放、分隔条键盘调整），
  // 拖拽过程中不触发；isUserInteraction=false 的程序化变更（如上面的 effect 同步）
  // 不回写，防止 effect → resize → 回写 的反馈回路。
  function handleLayoutChanged(_layout: Layout, meta: LayoutChangedMeta) {
    if (!meta.isUserInteraction) return;
    const listPanel = listPanelRef.current;
    if (listPanel) {
      const px = Math.round(listPanel.getSize().inPixels);
      const collapsed = listPanel.isCollapsed() || px <= 1;
      if (collapsed !== listCollapsed) setListCollapsed(collapsed);
      if (!collapsed && Math.abs(px - listWidth) > 1) setListWidth(px);
    }
    const drawerPanel = drawerPanelRef.current;
    if (drawerPanel) {
      const px = Math.round(drawerPanel.getSize().inPixels);
      // 右侧拖到接近 0 视为关闭抽屉
      if (drawer && (drawerPanel.isCollapsed() || px <= 1)) {
        onDrawerClose();
      } else if (drawer && Math.abs(px - drawerWidth) > 1) {
        setDrawerWidth(px);
      }
    }
  }

  return (
    <div
      className={[
        "wechat-shell",
        drawer ? "drawer-open" : "",
        listCollapsed ? "list-collapsed" : "",
        drawerCollapsed ? "drawer-collapsed" : "",
        useNativeTitleBar ? "" : "custom-titlebar-enabled",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--list-width": `${listCollapsed ? 0 : listWidth}px`,
          "--list-expanded-width": `${listWidth}px`,
          "--list-hover-width": `${Math.max(190, listWidth)}px`,
          "--drawer-width": `${drawer && !drawerCollapsed ? drawerWidth : 0}px`,
          "--drawer-col-w": `${drawer && !drawerCollapsed ? drawerWidth : 0}px`,
          "--drawer-splitter-w": `${drawer && !drawerCollapsed ? 6 : 0}px`,
        } as CSSProperties
      }
    >
      <AppHeader
        useNativeTitleBar={useNativeTitleBar}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
        minimizeWindow={minimizeWindow}
        toggleMaximizeWindow={toggleMaximizeWindow}
        isWindowMaximized={isWindowMaximized}
        onWindowMaximizedChange={onWindowMaximizedChange}
        closeWindow={closeWindow}
      />
      <ResizablePanelGroup orientation="horizontal" className="shell-panel-group" onLayoutChanged={handleLayoutChanged}>
        <ResizablePanel
          id="list"
          panelRef={listPanelRef}
          collapsible
          collapsedSize={LIST_COLLAPSED_SIZE}
          minSize={LIST_MIN}
          maxSize={LIST_MAX}
          defaultSize={listCollapsed ? LIST_COLLAPSED_SIZE : listWidth}
          className="shell-panel-list"
        >
          {sidebarContent}
        </ResizablePanel>
        <ResizableHandle className="splitter splitter-left" />

        <ResizablePanel id="chat" minSize={360} className="shell-panel-chat">
          <main
            ref={chatPaneRef}
            className="chat-pane"
            style={
              {
                "--terminal-row-h": `${terminalRowHeight}px`,
                ...(contentMaxWidth > 0 && contentMaxWidth < 1800
                  ? { "--content-max-width": `${contentMaxWidth}px` }
                  : undefined),
              } as CSSProperties
            }
          >
            {chatPaneContent}
          </main>
        </ResizablePanel>

        {/* 抽屉面板常驻挂载：关闭时必须仍可 collapse→0，否则 collapsible=false
            会卡在 minSize 留下右侧空白缝。 */}
        <ResizableHandle
          className="splitter splitter-right"
          data-active={Boolean(drawer) && !drawerCollapsed}
        />
        <ResizablePanel
          id="drawer"
          panelRef={drawerPanelRef}
          collapsible
          collapsedSize={0}
          minSize={DRAWER_MIN}
          maxSize={DRAWER_MAX}
          defaultSize={0}
          className="shell-panel-drawer"
        >
          <WorkspaceDrawerHost
            panel={drawer}
            collapsed={drawerCollapsed}
            onClose={onDrawerClose}
            rail={drawerRail}
            renderPanel={(panel) => drawerContent(panel)}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* 大纲浮层必须放在 Group 外：v4 只认 data-panel / data-separator 直系子节点，
          夹在 panel 之间会污染分隔条命中区计算（absolute 也不算例外）。 */}
      {outlineContent}
      {children}
    </div>
  );
}
