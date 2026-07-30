import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type RefObject, type ReactNode, type MutableRefObject } from "react";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
  type PanelSize,
} from "react-resizable-panels";
import type { AgentRuntimeState, GitBranchInfo, ImageContent, SessionRuntimeTarget } from "../../../../shared/types";
import type { SessionTimelineController } from "../../hooks/useSessionTimelineController";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import type { PiDesktopApi } from "../../../../preload";
import { t } from "../../i18n";
import { isLanWeb, desktopApi as api } from "../../desktopApi";
import { SessionHeader } from "./SessionHeader";
import { NoticeCenter } from "../overlays/NoticeCenter";
import { SessionMessageTimeline } from "./SessionMessageTimeline";
import { ComposerArea } from "./ComposerArea";
import { SessionRuntimeDock } from "./SessionRuntimeDock";
import { QueuedPromptPanel } from "./ComposerPanels";
import type { EnqueuePromptSnapshot } from "../../hooks/useSessionSend";

export type SessionViewProps = {
  // ── Session identity ──
  sessionId: string;
  sessionTitle: string;
  sessionTimeline: SessionTimelineController;
  activeAgentId?: string;
  activeAgent?: {
    compactionCount?: number;
    noSession?: boolean;
    status?: string;
  } | null;
  activeRuntimeState?: AgentRuntimeState;
  runtimeTarget?: SessionRuntimeTarget;
  hasActiveConversation: boolean;
  hasProject: boolean;

  // ── Layout refs ──
  chatHeaderRef: RefObject<HTMLElement | null>;
  sessionComboRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLElement | null>;
  composerOffsetHeight: number;
  terminalRowHeight: number;

  // ── Header state ──
  isAgentStarting: boolean;
  sessionActionsOpen: boolean;
  canStop: boolean;
  canRestart: boolean;
  restartingAgentId?: string;
  isRestarting: boolean;
  showRestart: boolean;
  sessionDuration?: number;

  // ── Header callbacks ──
  onHeaderTrigger: () => void;
  onNewSession: () => void;
  onStop: () => void;
  onRestart: () => void;
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;

  // ── Timeline interaction ──
  showThinking: boolean;
  validCommandNames: Set<string>;
  validFilePaths: Set<string>;
  onPreviewImage: (image: ImageContent) => void;
  onOpenFile?: (path: string) => void;
  onDiffFile?: (path: string) => void;
  onResendUserMessage?: (message: any) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onForkMessage?: (message: any) => void;
  forkingMessageId?: string | null;
  onToast: (message: string) => void;
  canMutateActiveMessages: boolean;

  // ── Composer ──
  enqueueSessionPrompt: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
  gitInfo?: GitBranchInfo;
  openFilePath?: (path: string) => void;
  ensureSessionId?: (sessionId: string) => Promise<string>;
  queuePanel?: ReactNode;
  runtimeUi?: ReactNode;

  // ── Terminal dock ──
  terminalDockVisible: boolean;
  terminalOpen: boolean;
  terminalDockClosing: boolean;
  terminalCollapsed: boolean;
  availableTerminalHeight: number;
  setTerminalOpenForAgent: (agentId: string, open: boolean) => void;
  setTerminalCollapsedForAgent: (agentId: string, collapsed: boolean) => void;
  setTerminalHeightByAgent: (
    updater: (current: Record<string, number>) => Record<string, number>
  ) => void;

  // ── Other visibility ──
  settingsOpen: boolean;
  configOpen: boolean;
  environmentDialog: boolean;

  // ── Session actions ──
  runCreateSessionDraft: () => void;
  abortAgent: () => void;
  restartActiveAgent: () => void;
};

export function SessionView({
  sessionId,
  sessionTitle,
  sessionTimeline,
  activeAgentId,
  activeAgent,
  activeRuntimeState,
  runtimeTarget,
  hasActiveConversation,
  hasProject,
  chatHeaderRef,
  sessionComboRef,
  composerRef,
  composerOffsetHeight,
  terminalRowHeight,
  isAgentStarting,
  sessionActionsOpen,
  canStop,
  canRestart,
  restartingAgentId,
  isRestarting,
  showRestart,
  sessionDuration,
  onHeaderTrigger,
  onNewSession,
  onStop,
  onRestart,
  onToggleDrawer,
  drawerOpen,
  showThinking,
  validCommandNames,
  validFilePaths,
  onPreviewImage,
  onOpenFile,
  onDiffFile,
  onResendUserMessage,
  onEditMessage,
  onDeleteMessage,
  onForkMessage,
  forkingMessageId,
  onToast,
  canMutateActiveMessages,
  enqueueSessionPrompt,
  gitInfo,
  openFilePath,
  ensureSessionId,
  queuePanel,
  runtimeUi,
  terminalDockVisible,
  terminalOpen,
  terminalDockClosing,
  terminalCollapsed,
  availableTerminalHeight,
  setTerminalOpenForAgent,
  setTerminalCollapsedForAgent,
  setTerminalHeightByAgent,
  settingsOpen,
  configOpen,
  environmentDialog,
  runCreateSessionDraft,
  abortAgent,
  restartActiveAgent,
}: SessionViewProps) {
  // #115 U5 垂直轴：timeline | composer | terminal 三段由 react-resizable-panels 接管。
  // composer 高度本地持有（px），终端高度/折叠仍由 useTerminalDock 的 per-agent
  // 状态持有，拖拽结果经 onResize 回写，外部状态经 imperative API 同步。
  const [composerHeight, setComposerHeight] = useState(175);
  const terminalPanelRef = useRef<PanelImperativeHandle | null>(null);

  // 终端 Panel 随 terminalOpen 动态挂载，约束注册有一帧延迟（与抽屉同款问题），
  // imperative 同步统一推迟一帧并容错。
  useEffect(() => {
    const panel = terminalPanelRef.current;
    if (!panel) return;
    const frame = requestAnimationFrame(() => {
      try {
        if (terminalCollapsed) { if (!panel.isCollapsed()) panel.collapse(); }
        else if (panel.isCollapsed()) panel.expand();
      } catch { /* 约束未就绪，下轮状态再同步 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [terminalCollapsed, terminalOpen, terminalDockVisible]);

  function handleComposerResize(size: PanelSize) {
    setComposerHeight(Math.round(size.inPixels));
  }

  function handleTerminalResize(size: PanelSize) {
    const px = Math.round(size.inPixels);
    if (!activeAgentId) return;
    // 34px 为折叠条高度：拖到折叠阈值视为折叠，拖回展开
    if (px <= 35) {
      if (!terminalCollapsed) setTerminalCollapsedForAgent(activeAgentId, true);
      return;
    }
    if (terminalCollapsed) setTerminalCollapsedForAgent(activeAgentId, false);
    const maxHeight = Math.max(120, availableTerminalHeight);
    setTerminalHeightByAgent((current) => ({
      ...current,
      [activeAgentId]: Math.min(px, maxHeight),
    }));
  }

  // 与旧拖拽实现一致的上限公式（渲染期快照，与旧行为同为非响应式）
  const composerMaxHeight = Math.max(175, Math.min(620, window.innerHeight - 260));
  const terminalPanelVisible =
    !isLanWeb && !settingsOpen && !configOpen && !environmentDialog &&
    terminalDockVisible && terminalOpen;

  return (
    <>
      <SessionHeader
        headerRef={chatHeaderRef}
        comboRef={sessionComboRef}
        title={sessionTitle}
        compactionCount={activeAgent?.compactionCount}
        isAnonymous={activeAgent?.noSession}
        runtimeState={activeRuntimeState}
        duration={sessionDuration}
        isStarting={isAgentStarting}
        hasProject={hasProject}
        hasSession={Boolean(activeAgentId || sessionId)}
        menuOpen={sessionActionsOpen}
        canStop={canStop}
        canRestart={canRestart}
        isRestarting={isRestarting}
        showRestart={showRestart}
        onTrigger={onHeaderTrigger}
        onNewSession={onNewSession}
        onStop={onStop}
        onRestart={onRestart}
        onToggleDrawer={onToggleDrawer}
        drawerOpen={drawerOpen}
      />
      <NoticeCenter />

      <Group orientation="vertical" className="session-v-group">
        <Panel id="timeline" minSize={160} className="session-v-timeline">
          <SessionMessageTimeline
        sessionId={sessionId}
        controller={sessionTimeline}
        hasProject={hasProject}
        onCreateSession={runCreateSessionDraft}
        showThinking={showThinking}
        validCommandNames={validCommandNames}
        validFilePaths={validFilePaths}
        onPreviewImage={onPreviewImage}
        onOpenExternal={(url: string) => api.app.openExternal(url)}
        onOpenFile={onOpenFile}
        onDiffFile={onDiffFile}
        onResendUserMessage={
          canMutateActiveMessages ? onResendUserMessage : undefined
        }
        onEditMessage={
          canMutateActiveMessages ? onEditMessage : undefined
        }
        onDeleteMessage={
          canMutateActiveMessages ? onDeleteMessage : undefined
        }
        onForkMessage={
          canMutateActiveMessages ? onForkMessage : undefined
        }
        forkingMessageId={forkingMessageId}
        onToast={onToast}
          />

          {sessionTimeline.showScrollToBottom && (
            <button
              className="scroll-to-bottom-btn"
              style={{
                bottom: Math.max(
                  24,
                  terminalRowHeight + composerOffsetHeight + 18,
                ),
              }}
              onClick={sessionTimeline.scrollToBottom}
              title={t("app.scrollToBottom")}
            >
              <ChevronDown size={18} />
            </button>
          )}
        </Panel>

        {hasActiveConversation && (
          <>
            <Separator className="v-splitter" />
            <Panel
              id="composer"
              minSize={175}
              maxSize={composerMaxHeight}
              defaultSize={composerHeight}
              onResize={handleComposerResize}
              className="session-v-composer"
            >
              <ComposerArea
                ref={composerRef}
                sessionId={sessionId}
                gitInfo={gitInfo}
                height={composerHeight}
                onOpenFile={openFilePath}
                enqueue={enqueueSessionPrompt}
                ensureSessionId={ensureSessionId}
                queuePanel={queuePanel}
                runtimeUi={runtimeUi}
              />
            </Panel>
          </>
        )}

        {terminalPanelVisible && (
          <>
            <Separator className="v-splitter" />
            <Panel
              id="terminal"
              panelRef={terminalPanelRef}
              collapsible
              collapsedSize={34}
              minSize={120}
              maxSize={Math.max(120, availableTerminalHeight)}
              defaultSize={terminalCollapsed ? 34 : terminalRowHeight}
              onResize={handleTerminalResize}
              className="session-v-terminal"
            >
              <SessionRuntimeDock
                target={runtimeTarget}
                mounted={terminalDockVisible}
                open={terminalOpen}
                closing={terminalDockClosing}
                collapsed={terminalCollapsed}
                height={terminalRowHeight}
                terminal={api.terminal}
                onOpenChange={(open) => {
                  if (activeAgentId) setTerminalOpenForAgent(activeAgentId, open);
                }}
                onCollapsedChange={(collapsed) => {
                  if (activeAgentId)
                    setTerminalCollapsedForAgent(activeAgentId, collapsed);
                }}
                onHeightChange={() => {
                  // 高度由面板 onResize 统一回写，此回调保留仅为兼容接口
                }}
              />
            </Panel>
          </>
        )}
      </Group>
    </>
  );
}
