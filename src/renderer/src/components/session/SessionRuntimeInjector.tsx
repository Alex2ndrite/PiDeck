import React from "react";
import { useAtomValue } from "jotai";
import type { AgentTab, AgentUiResponse, ChatMessage } from "../../../../shared/types";
import type { ImageContent } from "../../../../shared/types";
import { settingsOpenAtom } from "../../atoms";
import { useSessionRuntimeController } from "../../hooks/useSessionRuntimeController";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import type { SessionTimelineController } from "../../hooks/useSessionTimelineController";
import { QueuedPromptPanel } from "./ComposerPanels";
import { SessionView } from "./SessionView";

// ── stable props (don't change on streaming) ──

export interface SessionRuntimeInjectorProps {
  currentSessionId: string;
  sessionTitle: string;
  sessionTimeline: SessionTimelineController;
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
  restartActiveAgent: () => Promise<void>;
  runCreateSessionDraft: () => Promise<void>;
  enqueueSessionPrompt: (
    sessionId: string,
    snapshot: { displayText: string; message: string; images?: ImageContent[]; agentMode: string },
  ) => boolean;

  // Message handlers (match SessionView prop types)
  resendUserMessage?: (message: any) => void;
  editMessage?: (messageId: string, newText: string) => void;
  deleteMessage?: (messageId: string) => void;

  // Agents
  agents: AgentTab[];

  // Queue
  activeQueuedPrompts: QueuedPrompt[];
  visibleQueuedPrompts: QueuedPrompt[];
  queueRetract: (agentId: string, prompt: QueuedPrompt) => void;
  queueDiscard: (agentId: string, promptId: string) => void;
  queuedTrackRef: React.MutableRefObject<HTMLDivElement | null>;
  queueFlushByAgentRef: React.MutableRefObject<Set<string>>;
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;

  // Project
  activeProjectId: string | undefined;

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
  showNotice: (msg: string, dur?: number) => void;
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
    sessionTimeline,
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
    runCreateSessionDraft,
    enqueueSessionPrompt,
    resendUserMessage,
    editMessage,
    deleteMessage,
    agents,
    activeQueuedPrompts,
    visibleQueuedPrompts,
    queueRetract,
    queueDiscard,
    queuedTrackRef,
    queueFlushByAgentRef,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
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

  // ── internal runtime subscriptions (the reason this component exists) ──
  const runtime = useSessionRuntimeController({
    agents,
    queueFlushByAgentRef,
    queuedPrompts: {},
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    showNotice,
    showToast,
    api,
  });

  const activeAgent = runtime.activeAgentId
    ? agents.find((a) => a.id === runtime.activeAgentId)
    : undefined;

  const canMutateActiveMessages = runtime.canMutateActiveMessages;

  return (
    <SessionView
      sessionId={currentSessionId}
      sessionTitle={sessionTitle}
      sessionTimeline={sessionTimeline}
      activeAgentId={runtime.activeAgentId ?? undefined}
      activeAgent={activeAgent}
      activeRuntimeState={runtime.activeRuntimeState}
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
      showRestart={!isLanWeb}
      sessionDuration={runtime.sessionDuration}
      onHeaderTrigger={() => {
        if (runtime.activeAgentId || currentSessionId) {
          setSessionActionsOpen((open) => !open);
        } else {
          void runCreateSessionDraft();
        }
      }}
      onNewSession={() => {
        void runCreateSessionDraft();
        setSessionActionsOpen(false);
      }}
      onStop={() => {
        void abortAgent();
        setSessionActionsOpen(false);
      }}
      onRestart={() => void restartActiveAgent()}
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
      onSendUiResponse={(requestId, response) => {
        if (!runtime.activeAgentId) return;
        runtime.sendSessionUiResponse(requestId, response);
      }}
      onToast={(message: string) => showToast(message)}
      canMutateActiveMessages={canMutateActiveMessages}
      enqueueSessionPrompt={enqueueSessionPrompt}
      openFilePath={onOpenFile}
      queuePanel={
        runtime.activeAgentId ? (
          <QueuedPromptPanel
            trackRef={queuedTrackRef}
            agentId={runtime.activeAgentId}
            prompts={activeQueuedPrompts}
            visiblePrompts={visibleQueuedPrompts}
            onRetract={queueRetract}
            onDiscard={queueDiscard}
          />
        ) : undefined
      }
      terminalDockVisible={terminalDockVisible}
      terminalOpen={terminalOpen}
      terminalDockClosing={terminalDockClosing}
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
