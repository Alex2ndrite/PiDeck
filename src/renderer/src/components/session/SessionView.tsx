import { ChevronDown } from "lucide-react";
import type { RefObject, ReactNode, MutableRefObject } from "react";
import type { AgentRuntimeState, ImageContent } from "../../../../shared/types";
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
    status?: string;
  } | null;
  activeRuntimeState?: AgentRuntimeState;
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
  onSendUiResponse: (requestId: string, response: { value?: string | boolean; cancelled?: boolean; confirmed?: boolean }) => void;
  onToast: (message: string) => void;
  canMutateActiveMessages: boolean;

  // ── Composer ──
  enqueueSessionPrompt: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
  openFilePath?: (path: string) => void;
  queuePanel?: ReactNode;

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
  showThinking,
  validCommandNames,
  validFilePaths,
  onPreviewImage,
  onOpenFile,
  onDiffFile,
  onResendUserMessage,
  onEditMessage,
  onDeleteMessage,
  onSendUiResponse,
  onToast,
  canMutateActiveMessages,
  enqueueSessionPrompt,
  openFilePath,
  queuePanel,
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
  return (
    <>
      <SessionHeader
        headerRef={chatHeaderRef}
        comboRef={sessionComboRef}
        title={sessionTitle}
        compactionCount={activeAgent?.compactionCount}
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
      />
      <NoticeCenter />

      <SessionMessageTimeline
        mode="session"
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
        onSendUiResponse={(requestId, response) => {
          if (!activeAgentId) return;
          onSendUiResponse(requestId, response);
        }}
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

      {hasActiveConversation && (
        <ComposerArea
          ref={composerRef}
          sessionId={sessionId}
          onOpenFile={openFilePath}
          enqueue={enqueueSessionPrompt}
          queuePanel={queuePanel}
        />
      )}

      {!isLanWeb &&
        !settingsOpen &&
        !configOpen &&
        !environmentDialog &&
        terminalDockVisible && (
        <SessionRuntimeDock
          agentId={activeAgentId}
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
          onHeightChange={(height) => {
            if (!activeAgentId) return;
            const maxHeight = Math.max(120, availableTerminalHeight);
            setTerminalHeightByAgent((current) => ({
              ...current,
              [activeAgentId]: Math.min(height, maxHeight),
            }));
          }}
        />
      )}
    </>
  );
}
