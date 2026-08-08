import React from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { AgentTab, AgentUiResponse, ChatMessage, GitBranchInfo } from "../../../../shared/types";
import type { ImageContent } from "../../../../shared/types";
import { settingsOpenAtom } from "../../atoms";
import {
  claimSessionRuntimeUiResponseAtom,
  rollbackSessionRuntimeUiResponseAtom,
} from "../../atoms/session-atoms";
import {
  sessionRuntimeBySessionIdAtomFamily,
  sessionRuntimeUiBySessionIdAtomFamily,
} from "../../atoms/session-selectors";
import { useSessionRuntimeController } from "../../hooks/useSessionRuntimeController";
import {
  createSessionRuntimeUiResponder,
  SessionRuntimeUiOverlay,
} from "../overlays/SessionRuntimeUiOverlay";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import type { SessionTimelineController } from "../../hooks/useSessionTimelineController";
import { QueuedPromptPanel } from "./ComposerPanels";
import { SessionView } from "./SessionView";
import type { SessionTabsBarProps } from "./SessionTabsBar";

// ── stable props (don't change on streaming) ──

export interface SessionRuntimeInjectorProps {
  currentSessionId: string;
  sessionTitle: string;
  sessionTabs: Omit<SessionTabsBarProps, "actions">;
  sessionTimeline: SessionTimelineController;
  /**
   * full：Tab 栏 + 嵌入 Header（单栏默认）；
   * pane：仅本栏 Header（会话分屏时由外层共享 Tab 栏）。
   */
  chrome?: "full" | "pane";
  /** 本栏是否为聚焦会话（影响终端挂载与点击聚焦）。缺省视为聚焦。 */
  focused?: boolean;
  onFocusPane?: () => void;
  sessionActionsOpen: boolean;
  setSessionActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLanWeb: boolean;

  // Layout refs (typed loosely to match existing SessionView/App ref patterns)
  chatHeaderRef: any;
  sessionComboRef: any;
  composerRef: any;
  composerOffsetHeight: number;
  terminalRowHeight: number;

  // Callbacks
  showToast: (msg: string, dur?: number) => void;
  onOpenFile: (path: string) => void;
  onDiffFile: (path: string) => void;
  onPreviewImage: (img: ImageContent | null) => void;
  abortAgent: (agentId?: string) => Promise<void>;
  /** 重启指定 Agent；不传则由注入器使用本栏 runtime 的 agentId。 */
  restartActiveAgent: (agentId?: string) => Promise<void>;
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
  runCreateSessionDraft: () => Promise<void>;
  enqueueSessionPrompt: (
    sessionId: string,
    snapshot: { displayText: string; message: string; images?: ImageContent[]; agentMode: string; behavior?: "steer" | "followUp" },
  ) => boolean;
  /** 新建 Agent 空态中的快捷 prompt 只写入 composer，发送由用户确认。 */
  insertQuickPrompt: (sessionId: string, message: string) => void;
  ensureSessionId?: (sessionId: string) => Promise<string>;

  // Message handlers (match SessionView prop types)
  resendUserMessage?: (message: any) => void;
  editMessage?: (messageId: string, newText: string) => void;
  deleteMessage?: (messageId: string) => void;
  forkFromUserMessage?: (message: any) => void;
  forkingMessageId?: string | null;
  /** 分支导航条切换会话（App 装配 useSessionActions.openSidebarSessionById） */
  openSidebarSessionById?: (projectId: string, sessionId: string) => Promise<void>;

  // Agents
  agents: AgentTab[];

  // Queue
  activeQueuedPrompts: QueuedPrompt[];
  visibleQueuedPrompts: QueuedPrompt[];
  queueRetract: (sessionId: string, prompt: QueuedPrompt) => void;
  queueDiscard: (sessionId: string, promptId: string) => void;
  queuedTrackRef: React.MutableRefObject<HTMLDivElement | null>;
  queueFlushBySessionRef: React.MutableRefObject<Set<string>>;
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;

  // Project
  activeProjectId: string | undefined;
  gitInfo: GitBranchInfo;

  // Settings
  showThinking: boolean;
  validCommandNames: Set<string>;
  validFilePaths: Set<string>;

  // Terminal
  terminalOpen: boolean;
  terminalDockClosing: boolean;
  terminalDockVisible: boolean;
  terminalCollapsed: boolean;
  availableTerminalHeight: number;
  setTerminalOpenForAgent: (agentId: string, open: boolean) => void;
  setTerminalCollapsedForAgent: (agentId: string, collapsed: boolean) => void;
  setTerminalHeightByAgent: (updater: (cur: Record<string, number>) => Record<string, number>) => void;

  // Overlays
  configOpen: boolean;
  environmentDialog: boolean;

  // Runtime UI
  showNotice: (msg: string, dur?: number, kind?: "info" | "warning" | "error") => import("../../utils/notice").NoticeId | undefined;
  api: {
    sessions: {
      sendUiResponse: (input: {
        sessionId: string;
        requestId: string;
        agentId: string;
        runtimeGeneration: number;
        response: AgentUiResponse;
      }) => Promise<void>;
    };
  };
}

// ── component ──

export const SessionRuntimeInjector = React.memo(function SessionRuntimeInjector(
  props: SessionRuntimeInjectorProps,
) {
  const {
    currentSessionId,
    sessionTitle,
    sessionTabs,
    sessionTimeline,
    chrome = "full",
    focused = true,
    onFocusPane,
    sessionActionsOpen,
    setSessionActionsOpen,
    isLanWeb,
    chatHeaderRef,
    sessionComboRef,
    composerRef,
    composerOffsetHeight,
    terminalRowHeight,
    showToast,
    onOpenFile,
    onDiffFile,
    onPreviewImage,
    abortAgent,
    restartActiveAgent,
    onToggleDrawer,
    drawerOpen,
    runCreateSessionDraft,
    enqueueSessionPrompt,
    insertQuickPrompt,
    ensureSessionId,
    resendUserMessage,
    editMessage,
    deleteMessage,
    forkFromUserMessage,
    forkingMessageId,
    openSidebarSessionById,
    agents,
    activeQueuedPrompts,
    visibleQueuedPrompts,
    queueRetract,
    queueDiscard,
    queuedTrackRef,
    queueFlushBySessionRef,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    gitInfo,
    showThinking,
    validCommandNames,
    validFilePaths,
    terminalOpen,
    terminalDockClosing,
    terminalDockVisible,
    terminalCollapsed,
    availableTerminalHeight,
    setTerminalOpenForAgent,
    setTerminalCollapsedForAgent,
    setTerminalHeightByAgent,
    configOpen,
    environmentDialog,
    showNotice,
    api,
  } = props;
  const settingsOpen = useAtomValue(settingsOpenAtom);
  // 本栏只订本会话 family，与 runtime controller 同源，避免分屏串扰
  const currentSessionRuntime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(currentSessionId));
  const currentSessionRuntimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(currentSessionId));
  const claimSessionUiResponse = useSetAtom(claimSessionRuntimeUiResponseAtom);
  const rollbackSessionUiResponse = useSetAtom(rollbackSessionRuntimeUiResponseAtom);
  const runtimeRef = React.useRef(currentSessionRuntime);
  runtimeRef.current = currentSessionRuntime;

  const runtimeUiResponder = React.useMemo(() => {
    if (!currentSessionRuntime?.agentId) return undefined;
    const binding = {
      sessionId: currentSessionId,
      agentId: currentSessionRuntime.agentId,
      runtimeGeneration: currentSessionRuntime.runtimeGeneration,
    };

    return createSessionRuntimeUiResponder({
      binding,
      // A response is valid only for the runtime that issued the request. The ref
      // lets the responder reject a detach/rebind occurring between click and IPC.
      readBinding: () => {
        const latest = runtimeRef.current;
        return latest?.agentId
          ? {
              sessionId: currentSessionId,
              agentId: latest.agentId,
              runtimeGeneration: latest.runtimeGeneration,
            }
          : undefined;
      },
      claim: claimSessionUiResponse,
      rollback: rollbackSessionUiResponse,
      send: api.sessions.sendUiResponse,
      onError: (error) => showToast(error instanceof Error ? error.message : String(error), 4000),
    });
  }, [
    api.sessions.sendUiResponse,
    claimSessionUiResponse,
    currentSessionId,
    currentSessionRuntime?.agentId,
    currentSessionRuntime?.runtimeGeneration,
    rollbackSessionUiResponse,
    showToast,
  ]);

  // ── internal runtime subscriptions (the reason this component exists) ──
  const runtime = useSessionRuntimeController({
    sessionId: currentSessionId,
    agents,
    queueFlushBySessionRef,
    activeQueuedPrompts,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    showNotice,
  });

  const activeAgent = runtime.activeAgentId
    ? agents.find((a) => a.id === runtime.activeAgentId)
    : undefined;

  const canMutateActiveMessages = runtime.canMutateActiveMessages;

  return (
    <SessionView
      sessionId={currentSessionId}
      sessionTitle={sessionTitle}
      sessionTabs={sessionTabs}
      sessionTimeline={sessionTimeline}
      chrome={chrome}
      focused={focused}
      onFocusPane={onFocusPane}
      activeAgentId={runtime.activeAgentId ?? undefined}
      activeAgent={activeAgent}
      activeRuntimeState={runtime.activeRuntimeState}
      runtimeTarget={runtime.runtimeTarget}
      hasActiveConversation={runtime.hasActiveConversation}
      hasProject={runtime.sessionHasProject}
      chatHeaderRef={chatHeaderRef}
      sessionComboRef={sessionComboRef}
      composerRef={composerRef}
      composerOffsetHeight={composerOffsetHeight}
      terminalRowHeight={terminalRowHeight}
      isAgentStarting={runtime.isAgentStarting}
      sessionActionsOpen={sessionActionsOpen}
      canStop={runtime.canStopSession}
      canRestart={runtime.canRestartSession}
      restartingAgentId={restartingAgentId ?? undefined}
      isRestarting={runtime.isRestartingThisAgent}
      // 没有绑定运行时的草稿也会有会话 ID，但重启只对已启动 Agent 有意义。
      showRestart={Boolean(runtime.activeAgentId) && !isLanWeb}
      sessionDuration={runtime.sessionDuration}
      onHeaderTrigger={() => {
        onFocusPane?.();
        if (runtime.activeAgentId || currentSessionId) {
          setSessionActionsOpen((open) => !open);
        } else {
          void runCreateSessionDraft();
        }
      }}
      onStop={() => {
        // 必须带本栏 agentId，避免分屏时误停聚焦栏 Agent
        void abortAgent(runtime.activeAgentId);
        setSessionActionsOpen(false);
      }}
      onRestart={() => void restartActiveAgent(runtime.activeAgentId)}
      // 分屏栏（pane）不重复挂右侧抽屉按钮：统一由共享 Tab 栏提供一处入口
      onToggleDrawer={chrome === "full" ? onToggleDrawer : undefined}
      drawerOpen={drawerOpen}
      showThinking={showThinking}
      validCommandNames={validCommandNames}
      validFilePaths={validFilePaths}
      onPreviewImage={onPreviewImage}
      onOpenFile={onOpenFile}
      onDiffFile={onDiffFile}
      onResendUserMessage={
        canMutateActiveMessages ? resendUserMessage : undefined
      }
      onEditMessage={
        canMutateActiveMessages ? editMessage : undefined
      }
      onDeleteMessage={
        canMutateActiveMessages ? deleteMessage : undefined
      }
      onForkMessage={
        canMutateActiveMessages ? forkFromUserMessage : undefined
      }
      forkingMessageId={forkingMessageId}
      onToast={(message: string) => showToast(message)}
      onQuickPrompt={(message) => insertQuickPrompt(currentSessionId, message)}
      canMutateActiveMessages={canMutateActiveMessages}
      onOpenBranchSession={
        // 分支导航条切到父/兄弟/子分支会话；无项目上下文时不提供
        activeProjectId && openSidebarSessionById
          ? (sessionId: string) => {
              void openSidebarSessionById(activeProjectId, sessionId);
            }
          : undefined
      }
      enqueueSessionPrompt={enqueueSessionPrompt}
      gitInfo={gitInfo}
      ensureSessionId={ensureSessionId}
      openFilePath={onOpenFile}
      runtimeUi={
        runtimeUiResponder ? (
          <SessionRuntimeUiOverlay
            sessionId={currentSessionId}
            runtime={currentSessionRuntime}
            ui={currentSessionRuntimeUi}
            responder={runtimeUiResponder}
            onExpandedChange={(expanded) => {
              if (!expanded) return;
              // Radix 在下一帧才把内容高度恢复；延迟到底部滚动，避免 scrollHeight 仍是收起值。
              requestAnimationFrame(() => sessionTimeline.scrollToBottom());
            }}
          />
        ) : null
      }
      queuePanel={
        currentSessionId ? (
          <QueuedPromptPanel
            trackRef={queuedTrackRef}
            sessionId={currentSessionId}
            prompts={activeQueuedPrompts}
            visiblePrompts={visibleQueuedPrompts}
            onRetract={queueRetract}
            onDiscard={queueDiscard}
          />
        ) : undefined
      }
      terminalDockVisible={focused && terminalDockVisible}
      terminalOpen={focused && terminalOpen}
      terminalDockClosing={focused && terminalDockClosing}
      terminalCollapsed={terminalCollapsed}
      availableTerminalHeight={availableTerminalHeight ?? 120}
      setTerminalOpenForAgent={setTerminalOpenForAgent}
      setTerminalCollapsedForAgent={setTerminalCollapsedForAgent}
      setTerminalHeightByAgent={setTerminalHeightByAgent}
      settingsOpen={settingsOpen}
      configOpen={configOpen}
      environmentDialog={environmentDialog}
      runCreateSessionDraft={runCreateSessionDraft}
      abortAgent={abortAgent}
      restartActiveAgent={restartActiveAgent}
    />
  );
});
