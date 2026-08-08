import {
  createContext,
  useContext,
  useMemo,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import type { AgentTab, AgentUiResponse, ChatMessage, GitBranchInfo, ImageContent, TerminalTarget } from "../../../../shared/types";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import type { NoticeId } from "../../utils/notice";

/**
 * 会话栏共享服务：跨分屏双栏稳定不变的回调与资源。
 * 身份（sessionId / focused）不进这里，避免大 props 袋透传。
 */
export type SessionPaneServices = {
  isLanWeb: boolean;
  showToast: (msg: string, dur?: number) => void;
  onOpenFile: (path: string) => void;
  onDiffFile: (path: string) => void;
  onPreviewImage: (img: ImageContent | null) => void;
  abortAgent: (agentId?: string) => Promise<void>;
  restartActiveAgent: (agentId?: string) => Promise<void>;
  runCreateSessionDraft: () => Promise<void>;
  enqueueSessionPrompt: (
    sessionId: string,
    snapshot: {
      displayText: string;
      message: string;
      images?: ImageContent[];
      agentMode: string;
      behavior?: "steer" | "followUp";
    },
  ) => boolean;
  insertQuickPrompt: (sessionId: string, message: string) => void;
  ensureSessionId?: (sessionId: string) => Promise<string>;
  resendUserMessage?: (message: ChatMessage) => void;
  editMessage?: (messageId: string, newText: string) => void;
  deleteMessage?: (messageId: string) => void;
  forkFromUserMessage?: (message: ChatMessage) => void;
  forkingMessageId?: string | null;
  openSidebarSessionById?: (projectId: string, sessionId: string) => Promise<void>;
  agents: AgentTab[];
  queuedPromptsBySession: Record<string, QueuedPrompt[]>;
  queueRetract: (sessionId: string, prompt: QueuedPrompt) => void;
  queueDiscard: (sessionId: string, promptId: string) => void;
  queueFlushBySessionRef: MutableRefObject<Set<string>>;
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;
  activeProjectId: string | undefined;
  gitInfo: GitBranchInfo;
  showThinking: boolean;
  validCommandNames: Set<string>;
  validFilePaths: Set<string>;
  terminalOpen: boolean;
  terminalDockClosing: boolean;
  terminalDockVisible: boolean;
  terminalCollapsed: boolean;
  availableTerminalHeight: number;
  /** 终端归属键（agent:<id> / project:<id>）：dock 实例与状态回写按它隔离 */
  terminalOwnerKey?: string;
  /** agent 或 project 终端目标（App 层按 owner 解析） */
  terminalTarget?: TerminalTarget;
  setTerminalOpenForOwner: (open: boolean) => void;
  setTerminalCollapsedForOwner: (collapsed: boolean) => void;
  setTerminalHeightByOwner: (
    updater: (cur: Record<string, number>) => Record<string, number>,
  ) => void;
  configOpen: boolean;
  environmentDialog: boolean;
  showNotice: (
    msg: string,
    dur?: number,
    kind?: "info" | "warning" | "error",
  ) => NoticeId | undefined;
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
  jumpToMessageRef: MutableRefObject<((messageId: string) => void) | null>;
  layoutRefs: {
    chatHeaderRef: RefObject<HTMLDivElement | null>;
    composerRef: RefObject<HTMLElement | null>;
    composerOffsetHeight: number;
    terminalRowHeight: number;
  };
  /** 退出会话左右/上下分屏，回到单栏 */
  exitSessionSplit: () => void;
};

const SessionPaneServicesContext = createContext<SessionPaneServices | null>(null);

export function SessionPaneServicesProvider(props: {
  value: SessionPaneServices;
  children: ReactNode;
}) {
  // 调用方应尽量 memo value；此处再包一层避免无意义的 Provider identity 抖动误导
  const value = useMemo(() => props.value, [props.value]);
  return (
    <SessionPaneServicesContext.Provider value={value}>
      {props.children}
    </SessionPaneServicesContext.Provider>
  );
}

export function useSessionPaneServices(): SessionPaneServices {
  const value = useContext(SessionPaneServicesContext);
  if (!value) {
    throw new Error("useSessionPaneServices must be used under SessionPaneServicesProvider");
  }
  return value;
}
