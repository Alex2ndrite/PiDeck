import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useCallback,
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sliders,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Code,
  Info,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Minus,
  FolderOpen,
  FolderCog,
  Globe,
  Pencil,
  Terminal,
  Filter,
  GitBranch,
  X,
} from "lucide-react";
import { showNotice } from "./utils/notice";
import {
  desktopApi as api,
  isLanWeb,
  missingElectronPreload,
} from "./desktopApi";
const ConfigModal = lazy(() => import("./ConfigModal").then((m) => ({ default: m.ConfigModal })));
import { TerminalDock } from "./components/terminal/TerminalDock";
import {
  SidebarContent,
  type SidebarActions,
} from "./components/sidebar/SidebarContent";
import { useFeishuBridge } from "./hooks/useFeishuBridge";
import { useGlobalAgentListeners } from "./hooks/useGlobalAgentListeners";
import { useSidebarController } from "./hooks/useSidebarController";
import { useProjectRuntimeCapabilities } from "./hooks/useRuntimeCapabilities";
import { useSessionRuntimeBridge } from "./hooks/useSessionRuntimeBridge";
import { useSessionMessages } from "./hooks/useSessionMessages";
import { useSessionSend } from "./hooks/useSessionSend";
import { useFileEditor } from "./hooks/useFileEditor";
import { useGitFlow } from "./hooks/useGitFlow";
import { useImportFlow } from "./hooks/useImportFlow";
import { useImagePaste } from "./hooks/useImagePaste";
import { useQueuedPrompt, type QueuedPrompt } from "./hooks/useQueuedPrompt";
import { PromptDeliveryUnknownError, createResendLock } from "./hooks/useComposerSend";

import { usePiUpdate } from "./hooks/usePiUpdate";
import { useProjectSync } from "./hooks/useProjectSync";
import {
  agentInventoryAtom,
  applyRuntimeCapabilityAtom,
  claimSessionRuntimeUiResponseAtom,
  currentSessionAttachmentsAtom,
  currentSessionAtom,
  currentSessionComposerModeAtom,
  currentSessionDraftAtom,
  currentSessionIdAtom,
  currentSessionRuntimeAtom,
  currentSessionRuntimeUiAtom,
  currentSessionSendStateAtom,
  projectInventoryAtom,
  removeSessionComposerStateAtom,
  removeSessionStateAtom,
  replaceAgentInventoryAtom,
  replaceProjectInventoryAtom,
  replaceProjectSessionsAtom,
  rollbackSessionRuntimeUiResponseAtom,
  sessionRecordByIdAtomFamily,
  sessionRecordsByProjectIdAtomFamily,
  sessionRecordToSummary,
  sessionIdByRuntimeAgentIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSummariesByProjectIdAtomFamily,
  setSessionAttachmentsAtom,
  setSessionCatalogLoadStateAtom,
  setSessionComposerModeAtom,
  setSessionDraftAtom,
  upsertAgentInventoryAtom,
  upsertSessionAtom,
} from "./atoms";
import { CloseIconButton } from "./components/ui/IconButton";
import {
  buildComposerPromptSubmission,
  expandPromptTemplates,
  getComposerEnterIntent,
  parseArgumentHint,
  translateBuiltinPromptDescription,
} from "./composerBehavior";
import {
  getAgentForSessionPath,
  getProjectAgentSessionDisplay,
  isSameSessionPath,
} from "./agentListDisplay";
import { resolveLocale, setI18nLocale, t } from "./i18n";
import { mergeAgentRuntimeState } from "./utils/agentRuntimeState";
import {
  migrateQueuedPrompts,
  QUEUED_PROMPT_LIMIT,
  QUEUED_PROMPT_VISIBLE,
} from "./utils/queuedPromptQueue";
import {
  pruneTerminalDockState,
  setTerminalDockCollapsed,
  setTerminalDockOpen,
  type TerminalDockStateByAgent,
} from "./terminalDockState";
import { useMessagePagination } from "./hooks/useMessagePagination";
import { useSessionTimelineController } from "./hooks/useSessionTimelineController";
import { useSessionLoader } from "./hooks/useSessionLoader";
import { useSessionActions } from "./hooks/useSessionActions";
import { useScratchPad } from "./hooks/useScratchPad";
import { SessionReferenceModal, type SessionReferenceResult } from "./components/app/SessionReferenceModal";
import { SessionMessageTimeline } from "./components/session/SessionMessageTimeline";
import { SessionHeader } from "./components/session/SessionHeader";
import { NoticeCenter } from "./components/overlays/NoticeCenter";
import { ComposerArea } from "./components/session/ComposerArea";
import { SessionRuntimeDock } from "./components/session/SessionRuntimeDock";
import {
  ComposerAttachmentBar,
  ComposerSendControls,
  ExtensionWidgetPanel,
  QueuedPromptPanel,
} from "./components/session/ComposerPanels";
import { ScratchPadOverlay } from "./components/overlays/ScratchPadOverlay";
import { WorkspaceDrawerHost } from "./components/workspace/WorkspaceDrawerHost";
import { AppHeader } from "./components/AppHeader";
import { RenameModals } from "./components/RenameModals";
import { SessionActionOverlays } from "./components/overlays/SessionActionOverlays";
import { AppUpdateOverlay } from "./components/overlays/AppUpdateOverlay";
import { ImportOverlayHost } from "./components/overlays/ImportOverlayHost";
import { EnvironmentOverlay } from "./components/overlays/EnvironmentOverlay";
import { SessionRuntimeUiOverlay, createSessionRuntimeUiResponder } from "./components/overlays/SessionRuntimeUiOverlay";
import { LazyWrapper } from "./hooks/useLazyComponent";
import {
  ConversationOutline,
  DrawerContent,
  EnvironmentDialog,
  FileContextMenu,
  ImagePreviewModal,
  LogoMark,
  ModelPicker,
  PromptTemplatePicker,

  ComposerModePicker,
  ThinkingPicker,
  WorktreeCreateDialog,
  type DrawerPanel,
  type SessionModifiedFile,
} from "./components/app/AppParts";
import { GitPanel } from "./components/app/GitPanel";
import { BrowserPanel, navigateTo } from "./components/app/BrowserPanel";
import {
  applySuggestion,
  buildOutline,
  buildSuggestionItems,
  clearSuggestionTrigger,
  detectTrigger,
  displayPath,
  flattenFiles,
  matches,
  mergeCommands,
  getToolFilePath,
  getToolNewContent,
  getToolChangedLineCount,
  countTextLines,
  type MessageItem,
} from "./components/app/AppUtils";
import {
	getCaretOffset as getCaretOffsetOf,
	getRichInputCaretCoords,
	parseRichInputChips,
	RichInput,
	type RichInputChip,
} from "./components/app/RichInput";
// 懒加载：Monaco Editor（~17.6MB Web Worker）仅在用户打开 diff 时才加载
const FileDiffViewer = lazy(() => import("./components/app/FileDiffViewer").then((m) => ({ default: m.FileDiffViewer })));
// 懒加载模态框，减少首屏 JS 体积
const SettingsModal = lazy(() => import("./components/app/SettingsModal").then((m) => ({ default: m.SettingsModal })));

const ProjectResourcesModal = lazy(() => import("./components/app/ProjectResourcesModal").then((m) => ({ default: m.ProjectResourcesModal })));
import { createDefaultExternalEditorSettings } from "../../shared/types";
import type {
  AgentRuntimeState,
  AgentTab,
  AgentUiRequest,
  AgentUiResponse,
  AppInfo,
  AppSettings,
  AppUpdateDownloadProgress,
  AppUpdateInfo,
  AvailableModel,
  PiCliUpdateResult,
  ExternalEditor,
  ChatMessage,
  CodexSessionSummary,
  ClaudeSessionSummary,
  OpenCodeSessionSummary,
  FileTreeNode,
  GitBranchInfo,
  CommitEntry,
  GitChangedFile,
  GitResourceGroupType,
  WorktreeEntry,
  ImageContent,
  PiCommand,
  PiInstallStatus,
  PiInstallExecResult,
  NpmAvailabilityResult,
  PiUpdateCheckResult,
  Project,
  SessionEnvironment,
  SessionRecord,
  SessionSummary,
  ComposerAgentMode,
} from "../../shared/types";

// 输入框默认高度增加,提供更好的输入体验,适合多行输入和代码片段
const COMPOSER_MIN_HEIGHT = 175;
const COMPOSER_DEFAULT_TERMINAL_HEIGHT = 220;
const COMPOSER_MIN_TIMELINE_HEIGHT = 160;
const TERMINAL_DOCK_MOTION_MS = 180;
function displayProjectDirectoryName(project: Project) {
  if (isChatProject(project)) return "Chat";
  const normalizedPath = project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.split("/").pop() || project.name || project.path;
}

function isChatProject(project?: Project) {
  return project?.kind === "chat";
}

function formatCodexSubagentName(session: SessionSummary) {
  const label = [session.codexAgentNickname, session.codexAgentRole]
    .filter(Boolean)
    .join(" · ");
  return label || session.name || t("app.codexSubagent");
}

/** pi 原生子会话名称：优先使用会话名，回退到 "子会话" */
function formatPiSubagentName(session: SessionSummary) {
  return session.name || t("app.piSubagent");
}


/** 从 localStorage 恢复会话来源过滤配置 */
function loadSessionSourceFilter(): Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null> {
	try {
		const raw = localStorage.getItem("pideck-session-source-filter");
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		const result: Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null> = {};
		for (const [key, val] of Object.entries(parsed)) {
			if (val === null) {
				result[key] = null;
			} else if (Array.isArray(val)) {
				result[key] = new Set(val);
			}
		}
		return result;
	} catch {
		return {};
	}
}

/** 将会话来源过滤持久化到 localStorage */
function saveSessionSourceFilter(filter: Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null>) {
	try {
		const obj: Record<string, string[] | null> = {};
		for (const [key, val] of Object.entries(filter)) {
			obj[key] = val === null ? null : [...val];
		}
		localStorage.setItem("pideck-session-source-filter", JSON.stringify(obj));
	} catch {
		// 静默失败
	}
}

const DISMISSED_EXTENSION_WIDGETS_STORAGE_KEY =
  "pid:extension-widget-dismissed-by-session";

function loadDismissedExtensionWidgets(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DISMISSED_EXTENSION_WIDGETS_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [sessionKey, widgetKeys] of Object.entries(parsed)) {
      if (Array.isArray(widgetKeys)) {
        result[sessionKey] = widgetKeys.filter(
          (widgetKey): widgetKey is string => typeof widgetKey === "string",
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveDismissedExtensionWidgets(value: Record<string, string[]>) {
  try {
    localStorage.setItem(
      DISMISSED_EXTENSION_WIDGETS_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // localStorage 可能因隐私模式/配额失败；关闭状态丢失不应影响主流程。
  }
}

function getAgentSessionStorageKey(agent?: AgentTab, fallbackAgentId?: string) {
  return agent?.sessionPath ?? fallbackAgentId ?? "";
}

type PendingAgentTab = AgentTab & {
  pendingKind?: "create" | "restart";
  pendingStartedAt?: number;
};

function inferSessionEnvironment(filePath?: string): SessionEnvironment {
  return filePath?.startsWith("/") ? "wsl" : "native";
}

function isReplacementForPendingAgent(agent: AgentTab, pending: PendingAgentTab) {
  if (agent.projectId !== pending.projectId || agent.cwd !== pending.cwd)
    return false;

  const environment = inferSessionEnvironment(pending.sessionPath);
  if (pending.pendingKind === "restart") {
    const startedAt = pending.pendingStartedAt ?? pending.createdAt;
    // 重启占位只匹配本次重启之后出现的新进程，避免误选同项目下已有的同名 Agent。
    if (agent.createdAt < startedAt - 1000) return false;
    if (isSameSessionPath(agent.sessionPath, pending.sessionPath, environment)) return true;
    return !pending.sessionPath && agent.title === pending.title;
  }

  if (!pending.id.startsWith("pending-")) return false;
  if (isSameSessionPath(agent.sessionPath, pending.sessionPath, environment)) return true;
  if (pending.sessionPath && agent.createdAt >= pending.createdAt - 1000)
    return true;
  return (
    agent.title === pending.title && agent.createdAt >= pending.createdAt - 1000
  );
}

function isPendingAgentId(agentId?: string) {
  return Boolean(agentId?.startsWith("pending-"));
}
const EDITOR_LOGO_URLS: Record<string, string> = {
  vscode: new URL("./assets/editors/vscode.png", import.meta.url).href,
  cursor: new URL("./assets/editors/cursor.png", import.meta.url).href,
  zed: new URL("./assets/editors/zed.png", import.meta.url).href,
  idea: new URL("./assets/editors/idea.svg", import.meta.url).href,
  webstorm: new URL("./assets/editors/webstorm.svg", import.meta.url).href,
  phpstorm: new URL("./assets/editors/phpstorm.svg", import.meta.url).href,
  pycharm: new URL("./assets/editors/pycharm.svg", import.meta.url).href,
};

function getEditorLogoUrl(editorId: string) {
  return EDITOR_LOGO_URLS[editorId];
}

function migrateAgentRecord<T>(
  current: Record<string, T>,
  replacementById: Map<string, string>,
  liveIds: Set<string>,
) {
  const next: Record<string, T> = {};
  for (const [agentId, value] of Object.entries(current)) {
    const nextAgentId = replacementById.get(agentId) ?? agentId;
    if (liveIds.has(nextAgentId)) next[nextAgentId] = value;
  }
  return next;
}

export function App() {
  if (missingElectronPreload) {
    return (
      <div className="boot-screen root-loading">
        <div className="boot-logo root-loading-logo">
          <LogoMark />
        </div>
        <strong>PiDeck</strong>
        <span>{t("app.preloadMissing")}</span>
      </div>
    );
  }

  useSessionRuntimeBridge();
  const store = useStore();
  const [, startPromptTransition] = useTransition();
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const currentSessionRuntime = useAtomValue(currentSessionRuntimeAtom);
  const currentSessionRuntimeRef = useRef(currentSessionRuntime);
  currentSessionRuntimeRef.current = currentSessionRuntime;
  const currentSessionRuntimeUi = useAtomValue(currentSessionRuntimeUiAtom);
  const currentSessionDraft = useAtomValue(currentSessionDraftAtom);
  const currentSessionAttachments = useAtomValue(currentSessionAttachmentsAtom);
  const currentSessionComposerMode = useAtomValue(currentSessionComposerModeAtom);
  const currentSessionSendState = useAtomValue(currentSessionSendStateAtom);
  const projects = useAtomValue(projectInventoryAtom);
  const agents = useAtomValue(agentInventoryAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const replaceProjectSessions = useSetAtom(replaceProjectSessionsAtom);
  const setProjects = useSetAtom(replaceProjectInventoryAtom);
  const setAgents = useSetAtom(replaceAgentInventoryAtom);
  const upsertAgent = useSetAtom(upsertAgentInventoryAtom);
  const applyRuntimeCapability = useSetAtom(applyRuntimeCapabilityAtom);
  const claimSessionUiResponse = useSetAtom(claimSessionRuntimeUiResponseAtom);
  const rollbackSessionUiResponse = useSetAtom(rollbackSessionRuntimeUiResponseAtom);
  const upsertSession = useSetAtom(upsertSessionAtom);
  const setSessionDraft = useSetAtom(setSessionDraftAtom);
  const setSessionAttachments = useSetAtom(setSessionAttachmentsAtom);
  const setSessionCatalogLoadState = useSetAtom(setSessionCatalogLoadStateAtom);
  const setSessionComposerMode = useSetAtom(setSessionComposerModeAtom);
  const removeSessionState = useSetAtom(removeSessionStateAtom);
  const sessionRuntimeUiResponder = useMemo(() => {
    if (!currentSessionId || !currentSessionRuntime?.agentId || currentSessionRuntime.runtimeGeneration == null) return undefined;
    const b = { sessionId: currentSessionId, agentId: currentSessionRuntime.agentId, runtimeGeneration: currentSessionRuntime.runtimeGeneration };
    return createSessionRuntimeUiResponder({ binding: b, readBinding: () => { const r = currentSessionRuntimeRef.current; return r?.agentId ? { sessionId: currentSessionId, agentId: r.agentId, runtimeGeneration: r.runtimeGeneration } : undefined; }, claim: (i) => claimSessionUiResponse(i), rollback: (i) => rollbackSessionUiResponse(i), send: async (i) => sendSessionUiResponse(i.requestId, i.response) });
  }, [currentSessionId, currentSessionRuntime?.agentId, currentSessionRuntime?.runtimeGeneration, claimSessionUiResponse, rollbackSessionUiResponse]);
  const removeSessionComposerState = useSetAtom(removeSessionComposerStateAtom);
  const {
    messages: currentSessionMessages,
    isLoading: currentSessionMessagesLoading,
  } = useSessionMessages(currentSessionId);
  const sessionTimeline = useSessionTimelineController({ sessionId: currentSessionId });
  const currentSessionIdRef = useRef<string | undefined>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const openSessionRequestRef = useRef(0);
  const creatingSessionDraftRef = useRef<Set<string>>(new Set());
  const sidebarController = useSidebarController({
    getRpcLogging: (agentId) => api.rpcLogs.getLogging(agentId),
  });

  // 项目的 git worktree 列表：{ parentId -> WorktreeEntry[] }
  const [pendingAgents, setPendingAgents] = useState<PendingAgentTab[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const activeProjectIdRef = useRef<string | undefined>(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const activeAgentId = currentSessionRuntime?.agentId;
  // 切换 agent（新会话/恢复会话）时刷新设置，使 pi agent 的 hideThinkingBlock 立即生效
  useEffect(() => {
    if (activeAgentId) {
      void api.settings.get().then(setSettings).catch(() => undefined);
    }
  }, [activeAgentId]);
  const activeAgentIdRef = useRef<string | undefined>(activeAgentId);
  activeAgentIdRef.current = activeAgentId;
  const agentsRef = useRef<AgentTab[]>(agents);
  agentsRef.current = agents;
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );


  const [commands, setCommands] = useState<PiCommand[]>([]);
  const runtimeStateByAgentRef = useRef<Record<string, AgentRuntimeState>>({});
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [promptTemplatePickerOpen, setPromptTemplatePickerOpen] = useState(false);
  const [promptTemplateList, setPromptTemplateList] = useState<
    Array<{ name: string; path: string; description: string; content: string; argumentHint?: string }>
  >([]);
  const [composerModePickerOpen, setComposerModePickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [sendBehaviorMenuOpen, setSendBehaviorMenuOpen] = useState(false);
  const sendBehaviorMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 如果用户在 Agent 忙碌时开始撰写，保持分段发送控件，避免 Agent 恰好结束时按钮在手边消失。
  const [busyDraftByAgent, setBusyDraftByAgent] = useState<Record<string, boolean>>({});
  const [sessionFeishuBotId, setSessionFeishuBotId] = useState<
    string | undefined
  >(undefined);
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [promptByAgent, setPromptByAgent] = useState<Record<string, string>>(
    {},
  );
  // contentEditable 的实时值通过 livePromptByAgentRef 保持最新，发送路径始终从这里读取草稿。
  // promptByAgent 仅用于驱动 RichInput 的 chip 渲染（非文本同步），只在 chips 变化时更新。
  const livePromptByAgentRef = useRef<Record<string, string>>({});
  // 仅跟踪输入框中是否有非空白文本（驱动发送按钮状态），避免每键触发全量 App 重渲染。
  const [hasComposerText, setHasComposerText] = useState(false);
  // 仅跟踪 ! / !! 前缀变化（驱动 CSS 类和 placeholder），避免每键触发重渲染。
  const [composerBangMode, setComposerBangMode] = useState<"none" | "bang" | "bang-bang">("none");
  /** 当前正在重启的 Agent，用于仅给对应会话显示 loading，避免切到其他 Agent 后仍被全局禁用。 */
  const [restartingAgentId, setRestartingAgentId] = useState<string | null>(null);
  /** 用户点击 ask_question 取消/abort 后的过渡标记，立即隐藏运行指示器。 */
  const [cancellingUi, setCancellingUi] = useState(false);
  const [attachedImagesByAgent, setAttachedImagesByAgent] = useState<
    Record<string, ImageContent[]>
  >({});
  const attachedImagesByAgentRef = useRef<Record<string, ImageContent[]>>(attachedImagesByAgent);
  attachedImagesByAgentRef.current = attachedImagesByAgent;
  const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);
  /** 存储用户在 select 弹框自定义输入框中键入的值，用于在后续 input 弹框中自动提交 */
  /** 外部编辑器列表 + 弹出气泡状态 */
  const [externalEditors, setExternalEditors] = useState<ExternalEditor[]>([]);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [editorsAnchor, setEditorsAnchor] = useState<{ x: number; y: number } | null>(null);
  /** 右键项目也能唤起编辑器气泡，所以这里显式记录本次要打开的目录，避免依赖运行中 agent 的 cwd。 */
  const [editorsTargetPath, setEditorsTargetPath] = useState<string | null>(null);
  /** 浏览器全屏模式：在完整窗口覆盖层中渲染浏览器面板，不受右侧抽屉宽度限制。 */
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const editorsRef = useRef<HTMLDivElement>(null);

  // 点击编辑器气泡外部时关闭
  useEffect(() => {
    if (!editorsOpen) return;
    const handler = (event: MouseEvent) => {
      if (editorsRef.current && !editorsRef.current.contains(event.target as Node)) {
        setEditorsOpen(false);
        setEditorsAnchor(null);
        setEditorsTargetPath(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editorsOpen]);
  /** Extension widget 容器折叠状态（全局持久化，不按 agentId 隔离，重启后恢复） */
  const [widgetsCollapsed, setWidgetsCollapsed] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pid:extension-widgets-collapsed") ?? "false") ??
        false
      );
    } catch {
      return false;
    }
  });
  /** 用户手动关闭的 extension widget（widgetKey）；按稳定 sessionPath 隔离，避免切换 agent 串状态。 */
  const [agentDismissedWidgets, setAgentDismissedWidgets] = useState<
    Record<string, string[]>
  >(() => loadDismissedExtensionWidgets());
  /** 输入框发送模式：normal 直接交给 agent，plan 通过隐藏标记触发 PiDeck Plan Mode 扩展。 */
  const [composerAgentModes, setComposerAgentModes] = useState<Record<string, ComposerAgentMode>>({});

  const activeAgentComposerMode = activeAgentId
    ? composerAgentModes[activeAgentId]
    : undefined;
  const currentComposerAgentMode = currentSessionId
    ? currentSessionComposerMode
    : (activeAgentComposerMode ?? "normal");
  const setComposerAgentModeForAgent = (agentId: string, mode: ComposerAgentMode) => {
    setComposerAgentModes((prev) => ({ ...prev, [agentId]: mode }));
  };
  const setCurrentComposerAgentMode = (mode: ComposerAgentMode) => {
    const sessionId = currentSessionIdRef.current;
    if (sessionId) {
      setSessionComposerMode({ sessionId, mode });
      return;
    }
    const targetAgentId = activeAgentIdRef.current;
    if (!targetAgentId) return;
    setComposerAgentModeForAgent(targetAgentId, mode);
  };
  /** 上一次 isAgentBusy 状态,用于检测 busy→idle 转换 */
  const prevIsAgentBusyRef = useRef(false);
  /** 客户端队列按 agent 记录 flush 锁，避免 tool-end 与 idle 并发投递。 */
  const queueFlushByAgentRef = useRef<Set<string>>(new Set());

  /** & 会话引用选择缓存：key = chip raw（如 "&My Session"），value = 选中的消息列表 */
  const [sessionRefSelections, setSessionRefSelections] = useState<
    Record<string, { messages: Array<{ role: string; content: string }>; fullContext: boolean; selectedIndices: number[] }>
  >({});

  /** 每个 agent 最后一次会话的开始时间(status 变为 running 时记录),用 ref 避免 effect 闭包陈旧 */
  const sessionStartByAgentRef = useRef<Record<string, number>>({});
  /** 每个 agent 最后一次会话的总时长(ms),仅在会话结束后更新 */
  const [sessionDurationByAgent, setSessionDurationByAgent] = useState<
    Record<string, number>
  >({});
  // 会话区不再维护独立的“修改文件摘要”卡片；diff 入口贴在 edit/write 工具调用处，
  // 避免会话输入框上方摘要与 Git 工作区状态/历史会话恢复互相干扰。
  const agentStatusByAgentRef = useRef<Record<string, AgentTab["status"]>>({});
  const [, setLogs] = useState<string[]>([]); // 写入式调试日志,仅用于 onLog/onError 捕获
  const [search, setSearch] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  // 记录 composer 光标位置,用于光标相关的 @ / 触发检测与建议项替换。
  const [composerCursor, setComposerCursor] = useState(0);
  const [fileMenu, setFileMenu] = useState<{
    x: number;
    y: number;
    node: FileTreeNode;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    danger?: boolean;
    confirmLabel?: string;
  } | null>(null);
  // 项目信任确认请求：含 .pi 资源且未记录决策的项目首次创建 Agent 时由主进程发起
  const [trustRequest, setTrustRequest] = useState<{
    requestId: string;
    cwd: string;
    projectName: string;
  } | null>(null);
  const [renamingFile, setRenamingFile] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [renamingFileInput, setRenamingFileInput] = useState("");
  const [agentMenu, setAgentMenu] = useState<{
    x: number;
    y: number;
    agent: AgentTab;
  } | null>(null);
  const [agentActionLoading, setAgentActionLoading] = useState<
    "copy" | "export" | null
  >(null);
  const [agentRenameTarget, setAgentRenameTarget] = useState<AgentTab | null>(
    null,
  );
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{
    projectId: string;
    session: SessionSummary;
  } | null>(null);
  /** 侧边栏删除确认：父会话包含子会话时弹窗提醒 */
  const [sidebarDeleteConfirm, setSidebarDeleteConfirm] = useState<{
    session: SessionSummary;
    childCount: number;
  } | null>(null);
  const [agentRenameValue, setAgentRenameValue] = useState("");
  const [agentRenaming, setAgentRenaming] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);
  /** worktree 创建进行中，用于禁用弹框按钮并显示"创建中" */
  const [worktreeCreating, setWorktreeCreating] = useState(false);
  /** 正在被删除的 worktree 路径集合：触发淡出动画期间保留 DOM，动画结束后才移除。 */
  const [removingWorktreePaths, setRemovingWorktreePaths] = useState<
    Set<string>
  >(() => new Set());
  /** 历史会话来源过滤（按项目）：undefined=显示全部，Record 含项目ID对应 Set */
  const [sessionSourceFilter] = useState<
  	Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null>
  >(() => loadSessionSourceFilter());
  /** 编辑器展示模式：弹框或侧栏 */
  // showToast 使用 app-notice 统一展示，见下方函数定义
  // 历史命令：按 agent 隔离，agent 关闭即清除（不持久化）
  const promptHistoryRef = useRef<Record<string, string[]>>({});
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyNavigating, setHistoryNavigating] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState("");
  const [compacting, setCompacting] = useState(false);
  const [drawer, setDrawer] = useState<DrawerPanel | null>(null);


  // ── 按项目目录持久化抽屉面板状态和展开目录（localStorage） ──
  // 文件侧边栏属于项目目录，所有在该项目下运行的 agent 共享同一套展开与面板状态。
  const PROJECT_DRAWER_KEY_PREFIX = "pid:project-drawer:";
  const PROJECT_EXPANDED_DIRS_KEY_PREFIX = "pid:project-expanded-dirs:";

  const saveDrawerState = useCallback((projectId: string, panel: DrawerPanel | null, pinned: boolean) => {
    try {
      localStorage.setItem(PROJECT_DRAWER_KEY_PREFIX + projectId, JSON.stringify({ panel, pinned }));
    } catch { /* localStorage 不可用时静默忽略 */ }
  }, []);

  const loadDrawerState = useCallback((projectId: string): { panel: DrawerPanel | null; pinned: boolean } | null => {
    try {
      const key = PROJECT_DRAWER_KEY_PREFIX + projectId;
      let raw = localStorage.getItem(key);
      if (!raw) {
        // 兼容旧版按 agent 保存的数据：尝试从该项目的任意 agent 读取并迁移到项目级
        const legacyAgents = agentsRef.current.filter((a) => a.projectId === projectId).map((a) => a.id);
        for (const agentId of legacyAgents) {
          const oldKey = `pid:agent-drawer:${agentId}`;
          const value = localStorage.getItem(oldKey);
          if (value) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, value);
            localStorage.removeItem(oldKey);
            raw = value;
            break;
          }
        }
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && (parsed.panel === null || ["files", "sessions", "browser", "editor", "git"].includes(parsed.panel))) {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  const saveExpandedDirs = useCallback((projectId: string, dirs: Set<string>) => {
    try {
      localStorage.setItem(PROJECT_EXPANDED_DIRS_KEY_PREFIX + projectId, JSON.stringify([...dirs]));
    } catch { /* ignore */ }
  }, []);

  const loadExpandedDirs = useCallback((projectId: string): Set<string> => {
    try {
      const key = PROJECT_EXPANDED_DIRS_KEY_PREFIX + projectId;
      let raw = localStorage.getItem(key);
      if (!raw) {
        const legacyAgents = agentsRef.current.filter((a) => a.projectId === projectId).map((a) => a.id);
        for (const agentId of legacyAgents) {
          const oldKey = `pid:agent-expanded-dirs:${agentId}`;
          const value = localStorage.getItem(oldKey);
          if (value) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, value);
            localStorage.removeItem(oldKey);
            raw = value;
            break;
          }
        }
      }
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch { /* ignore */ }
    return new Set();
  }, []);
  /** 打开文件编辑器前所在的抽屉面板，供返回按钮恢复 */
  const [sessionsProjectId, setSessionsProjectId] = useState<string>();
  const [projectResourcesProject, setProjectResourcesProject] = useState<Project | null>(null);
  const sessions = useAtomValue(
    sessionSummariesByProjectIdAtomFamily(sessionsProjectId ?? ""),
  );

  // ===== 项目同步 hook (H3) =====
  const {
    worktreesByProject,
    branchByProject,
    files,
    setFiles,
    gitInfo,
    setGitInfo,
    sessionLoadingByProject,
    setSessionLoadingByProject,
    visibleProjectChildCountByProject,
    setVisibleProjectChildCountByProject,
    refreshProjects,
    refreshWorktrees,
    refreshProjectSessions,
    refreshFiles,
    refreshProjectTree,
  } = useProjectSync({
    projects,
    activeProjectId,
    setProjects,
    setActiveProjectId,
    replaceProjectSessions,
    api: {
      projects: { list: api.projects.list },
      git: { worktreeList: api.git.worktreeList, branches: api.git.branches },
      sessions: { listCatalog: api.sessions.listCatalog },
      files: { list: api.files.list },
    },
    showToast,
    setSessionCatalogLoadState,
    t,
  });

  // === import flow hook ===
  const {
    codexImportProject,
    setCodexImportProject,
    claudeImportProject,
    setClaudeImportProject,
    openCodeImportProject,
    setOpenCodeImportProject,
    codexImportController,
    claudeImportController,
    openCodeImportController,
    openCodexImport,
    openClaudeImport,
    openOpenCodeImport,
  } = useImportFlow({
    setProjectMenu,
    refreshProjectSessions,
    showToast,
    scanCodexSessions: api.codexSessions.scan,
    importCodexSessionsApi: api.codexSessions.import,
    scanClaudeSessions: api.claudeSessions.scan,
    importClaudeSessionsApi: api.claudeSessions.import,
    scanOpenCodeSessions: api.openCodeSessions.scan,
    importOpenCodeSessionsApi: api.openCodeSessions.import,
    t,
  });

  const getProjectSessions = (projectId: string) =>
    store.get(sessionSummariesByProjectIdAtomFamily(projectId));
  const getProjectSessionRecords = (projectId: string) =>
    store.get(sessionRecordsByProjectIdAtomFamily(projectId));
  const getSessionRecord = (sessionId: string) =>
    store.get(sessionRecordByIdAtomFamily(sessionId));
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const [downloadedUpdatePath, setDownloadedUpdatePath] = useState<string | null>(null);
  const [upToDateVersion, setUpToDateVersion] = useState<string | null>(null);
  const appUpdateController = useMemo(() => ({
    info: updateInfo,
    error: updateError,
    checking: updateChecking,
    downloading: updateDownloading,
    progress: updateProgress,
    downloadedPath: downloadedUpdatePath,
    download: async () => { await downloadAppUpdate(); return downloadedUpdatePath; },
    install: async () => { if (downloadedUpdatePath) await api.app.installUpdate(downloadedUpdatePath); },
    clear: () => { setUpdateInfo(null); setUpdateError(null); setUpdateProgress(null); setDownloadedUpdatePath(null); setUpToDateVersion(null); },
    check: undefined as unknown as (source?: "auto" | "manual") => Promise<AppUpdateInfo | null>,
  }), [updateInfo, updateError, updateChecking, updateDownloading, updateProgress, downloadedUpdatePath]);
  const [configOpen, setConfigOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /** 是否自动滚动到最新消息 */
  const [autoScroll, setAutoScroll] = useState(true);
  /** 用 ref 同步 autoScroll，供 ResizeObserver 回调读取最新值，避免响应式时序间隙导致滚动抢跑。 */
  const autoScrollRef = useRef(true);
  autoScrollRef.current = autoScroll;
  /** 标记当前滚动是否由程序触发（ResizeObserver / scrollToBottom 等），
   *  用于在 scroll 事件中区分用户手动滚动，防止竞态误关 autoScroll。 */
  const programmaticScrollRef = useRef(false);
  /** 是否显示"移动到最新"按钮 */
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  /** 会话定位跳转到尚未加载的旧消息时，先扩展分页再在 effect 中滚动定位；此状态保存待跳转的消息 id。 */
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  /** 加载更多历史消息前的滚动锚点（旧 scrollHeight + scrollTop），用于渲染后按顶部锚定恢复滚动位置。 */
  const loadMoreAnchorRef = useRef<{ height: number; top: number } | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    useNativeTitleBar: true,
    showNativeMenu: false,
    sendShortcut: "enter-send",
    theme: "system",
    lightBackground: "white",
    language: "system",
    piEnvironmentChecked: false,
    enableGitManagement: true,
    closeToTray: true,
    enableNotifications: true,
    // showThinking 由 pi agent 的 hideThinkingBlock 控制，启动后从主进程加载的真实值会覆盖此处
    showThinking: true,
    showDevTools: false,
    piProxyEnabled: false,
    piProxyUrl: "http://127.0.0.1:7890",
    piProxyBypass: "localhost,127.0.0.1,::1",
    desktopProxyEnabled: false,
    desktopProxyUrl: "http://127.0.0.1:7890",
    desktopProxyBypass: "localhost,127.0.0.1,::1",
    customPiPath: "",
    wslEnabled: false,
    wslDistro: "Ubuntu",
    wslUser: "root",
    telemetryEnabled: true,
    webServiceEnabled: false,
    webServiceHost: "0.0.0.0",
    webServicePort: 8765,
    rpcTimeout: 600_000,
    linkOpenMode: "external",
    contentMaxWidth: 1400,
    maxEditorFileSizeMB: 5,
    externalEditors: createDefaultExternalEditorSettings(),

    // 桌面宠物默认关闭：关闭后应用与现状完全一致，零回归
    petEnabled: false,
    petId: "clawd",
    petAlwaysOnTop: true,
    petScale: 0.8,
    petPatrolEnabled: true,
    petPatrolPauseMin: 5,
    favoriteModels: [],

    // 字体配置：与 main SettingsStore 默认值保持一致，避免启动时闪烁
    fontSize: "default",
    uiFontSize: null,
    chatFontSize: null,
    inputFontSize: null,
    zoomFactor: 1,
    fontFamilyBase: "system",
    fontFamilyBaseCustom: "",
    fontFamilyMono: "commit-mono",
    fontFamilyMonoCustom: "",
    disableUpdateCheck: false,
  });
  /* settingsNotice 已改用 showToast (app-notice) 实现 */
  const [piStatus, setPiStatus] = useState<PiInstallStatus | null>(null);
  const [webServiceChanging, setWebServiceChanging] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    version: "-",
    releasesUrl: "https://github.com/ayuayue/pi-desktop/releases",
    platform: "win32",
  });
  const [piChecking, setPiChecking] = useState(false);
  const [systemLanguage, setSystemLanguage] = useState<string | null>(null);
  const resolvedLocale = resolveLocale(settings.language, systemLanguage ?? undefined);
  setI18nLocale(resolvedLocale);
  const [environmentDialog, setEnvironmentDialog] = useState(false);

  // ===== Pi 更新/安装/代理 hook (H1) =====
  const piUpdate = usePiUpdate({
    piStatus,
    setPiStatus,
    piChecking,
    setPiChecking,
    settings,
    setSettings,
    setEnvironmentDialog,
    setSettingsOpen,
    showToast,
    api,
  });
  const DEFAULT_LIST_WIDTH = 260;
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [drawerWidth, setDrawerWidth] = useState(270);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [composerOffsetHeight, setComposerOffsetHeight] = useState(0);
  /** ResizeObserver 驱动布局预算重新计算；ref 尺寸本身变化不会触发 React render。 */
  const [chatLayoutHeight, setChatLayoutHeight] = useState(() => window.innerHeight);
  const [composerAutoHeight, setComposerAutoHeight] =
    useState(COMPOSER_MIN_HEIGHT);
  const [terminalDockStateByAgent, setTerminalDockStateByAgent] =
    useState<TerminalDockStateByAgent>({});
  const [terminalHeightByAgent, setTerminalHeightByAgent] = useState<
    Record<string, number>
  >({});
  const [terminalDockMounted, setTerminalDockMounted] = useState(false);
  const [terminalDockClosing, setTerminalDockClosing] = useState(false);
  const [terminalDockAgentId, setTerminalDockAgentId] = useState<string>();
  const terminalDockCloseTimerRef = useRef<number | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listHoverRevealSuppressed, setListHoverRevealSuppressed] =
    useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [drawerPinnedByProject, setDrawerPinnedByProject] = useState<
    Record<string, DrawerPanel>
  >({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const chatPaneRef = useRef<HTMLElement | null>(null);
  const sessionComboRef = useRef<HTMLDivElement | null>(null);
  const chatHeaderRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLElement | null>(null);
  const queuedTrackRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLElement | null>(null);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLDivElement | null>(null);
  // RichInput 受控重渲染后,光标应恢复到的纯文本偏移(供建议选中/清除后恢复选区)。
  const pendingComposerCaretRef = useRef<number | null>(null);
  const pendingAgentsRef = useRef<PendingAgentTab[]>([]);

  // ===== 飞书桥接 =====

  const feishu = useFeishuBridge();
  const scratchPad = useScratchPad();

  // 当活跃项目切换时，从 localStorage 恢复该项目的抽屉面板状态和展开目录。
  // 文件侧边栏属于项目目录，因此按 projectId 持久化，同一项目下的不同 agent 共享状态。
  useEffect(() => {
    if (!activeProjectId) {
      setDrawer(null);
      setDrawerPinnedByProject((current) => current);
      setExpandedDirs(new Set());
      return;
    }
    const projectId = activeProjectId;
    const savedState = loadDrawerState(projectId);
    if (savedState) {
      const panel: DrawerPanel | null = savedState.panel;
      const canRestorePanel = panel !== "git" || settings.enableGitManagement;
      if (savedState.pinned && panel && canRestorePanel) {
        setDrawerPinnedByProject((current) => {
          if (current[projectId] === panel) return current;
          return { ...current, [projectId]: panel };
        });
      } else {
        setDrawerPinnedByProject((current) => {
          const next = { ...current };
          delete next[projectId];
          return next;
        });
      }
      if (panel && canRestorePanel) {
        setDrawer(panel);
        setDrawerCollapsed(false);
      } else {
        setDrawer(null);
      }
    } else {
      // 该项目没有持久化记录时，明确关闭抽屉并清除钉选，避免上一项目的状态泄漏。
      setDrawer(null);
      setDrawerPinnedByProject((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
    const dirs = loadExpandedDirs(projectId);
    setExpandedDirs(dirs);
  }, [activeProjectId, loadDrawerState, loadExpandedDirs, settings.enableGitManagement]);

  useEffect(() => {
    if (settings.enableGitManagement) return;

    // 关闭功能时同步移除当前项目的 Git 抽屉及钉选状态，避免隐藏入口后留下无法操作的面板。
    setDrawer((current) => current === "git" ? null : current);
    setDrawerPinnedByProject((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([, panel]) => panel !== "git"),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    if (activeProjectId) {
      const saved = loadDrawerState(activeProjectId);
      if (saved?.panel === "git") saveDrawerState(activeProjectId, null, false);
    }
  }, [activeProjectId, loadDrawerState, saveDrawerState, settings.enableGitManagement]);

  // 当活跃 Agent 切换或绑定列表变更时，加载该 Agent 指定的飞书 Bot
  // 绑定变更后同步刷新，确保配置页断开关联后已连接状态正确反映。
  useEffect(() => {
    if (!activeAgentId) {
      setSessionFeishuBotId(undefined);
      return;
    }
    feishu.getSessionBot(activeAgentId).then((botId) => {
      setSessionFeishuBotId(botId);
    });
  }, [activeAgentId, feishu.bindings]);

  // Bot 列表变更后，若当前会话固定的 Bot 已被删除，则清除本地缓存避免指示器展示已失效的固定状态。
  useEffect(() => {
    if (!sessionFeishuBotId) return;
    if (!feishu.bots.some((bot) => bot.id === sessionFeishuBotId)) {
      setSessionFeishuBotId(undefined);
    }
  }, [feishu.bots, sessionFeishuBotId]);

  const activeProjectRuntimeCapabilities = useProjectRuntimeCapabilities(activeProjectId);
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const sessionsProject = projects.find(
    (project) => project.id === sessionsProjectId,
  );
  const displayAgents = useMemo(() => {
    const realIds = new Set(agents.map((agent) => agent.id));
    return [
      ...agents,
      ...pendingAgents.filter(
        (agent) =>
          !realIds.has(agent.id) &&
          !agents.some((realAgent) =>
            isReplacementForPendingAgent(realAgent, agent),
          ),
      ),
    ];
  }, [agents, pendingAgents]);
  // displayAgents 的 ref，供只挂载一次的 IPC 监听器读取最新 Agent 列表，避免闭包陈旧
  const displayAgentsRef = useRef(displayAgents);
  displayAgentsRef.current = displayAgents;
  // Agent 关闭后清除对应历史命令
  useEffect(() => {
    const currentIds = new Set(displayAgents.map(a => a.id));
    for (const id of Object.keys(promptHistoryRef.current)) {
      if (!currentIds.has(id)) delete promptHistoryRef.current[id];
    }
  }, [displayAgents]);
  // Session/Agent 切换时重置历史导航状态，避免输入历史串会话。
  useEffect(() => {
    setHistoryIndex(-1);
    setHistoryNavigating(false);
    setSavedPrompt("");
  }, [activeAgentId, currentSessionId]);
  // 查看器已移除：activeAgent 直接从 displayAgents / pendingAgents 取，不再有伪 Agent。
  const activeAgent = activeAgentId
    ? [...displayAgents, ...pendingAgents].find((agent) => agent.id === activeAgentId)
    : undefined;
  const activeWidgetSessionKey = activeAgentId
    ? getAgentSessionStorageKey(activeAgent, activeAgentId)
    : undefined;
  // prompt 文本：优先从 live ref 读取（始终保持最新），promptByAgent 仅在 chips 变化时更新作为兜底。
  // 不建立 state 依赖——普通按键不会触发 App 重渲染，仅靠 hasComposerContent / composerBangMode
  // 等布尔状态在真正翻转时驱动 UI 刷新。建议框打开时由 composerCursor 变化驱动重渲染。
  const promptAgentKey = currentSessionId ?? activeAgentId ?? "";
  const prompt = currentSessionId
    ? (livePromptByAgentRef.current[currentSessionId] ?? currentSessionDraft)
    : promptAgentKey
      ? (livePromptByAgentRef.current[promptAgentKey] ?? promptByAgent[promptAgentKey] ?? "")
      : "";
  const attachedImages = currentSessionId
    ? currentSessionAttachments
    : activeAgentId
      ? (attachedImagesByAgent[activeAgentId] ?? [])
      : [];

  useEffect(() => {
    syncComposerFlags(prompt);
  }, [activeAgentId, currentSessionId]);

  function setPromptForAgent(
    agentId: string,
    value: string | ((current: string) => string),
  ) {
    const targetAgentId = agentId;
    const previous = livePromptByAgentRef.current[targetAgentId] ?? "";
    const nextValue = typeof value === "function" ? value(previous) : value;
    if (nextValue) livePromptByAgentRef.current[targetAgentId] = nextValue;
    else delete livePromptByAgentRef.current[targetAgentId];
    // 程序化更新（建议选择、历史恢复、发送后清空等）需要同步更新 state。
    if (currentSessionIdRef.current === targetAgentId || getSessionRecord(targetAgentId)) {
      setSessionDraft({ sessionId: targetAgentId, value: nextValue });
      if (currentSessionIdRef.current === targetAgentId) syncComposerFlags(nextValue);
      return;
    }
    syncComposerFlags(nextValue);
    setPromptByAgent((current) => {
      if (!nextValue) {
        const next = { ...current };
        delete next[targetAgentId];
        return next;
      }
      return {
        ...current,
        [targetAgentId]: nextValue,
      };
    });
  }

  /** 同步 hasComposerText / composerBangMode 等布尔状态，仅在值翻转时触发重渲染。 */
  function syncComposerFlags(text: string) {
    const hasContent = text.trim().length > 0;
    setHasComposerText((prev) => (prev !== hasContent ? hasContent : prev));
    const bangMode: "none" | "bang" | "bang-bang" = text.startsWith("!!")
      ? "bang-bang"
      : text.startsWith("!")
        ? "bang"
        : "none";
    setComposerBangMode((prev) => (prev !== bangMode ? bangMode : prev));
  }

  function setPromptFromNativeInput(agentId: string, value: string) {
    // 同步更新 live ref（发送路径读取）。Session 草稿同时写入 atom，切换后可立即恢复。
    if (value) livePromptByAgentRef.current[agentId] = value;
    else delete livePromptByAgentRef.current[agentId];

    syncComposerFlags(value);
    if (currentSessionIdRef.current === agentId || getSessionRecord(agentId)) {
      startPromptTransition(() => {
        setSessionDraft({ sessionId: agentId, value });
      });
      return;
    }

    // 仅 chips 变化时才更新旧 Agent state（触发 RichInput 的 chips 重算 + renderDom）。
    const oldValue = promptByAgent[agentId] ?? "";
    const oldChipsKey = parseRichInputChips(oldValue, validCommandNames, validFilePaths, validSessionRefs)
      .map((c) => `${c.start}:${c.end}:${c.kind}`)
      .join(",");
    const newChipsKey = parseRichInputChips(value, validCommandNames, validFilePaths, validSessionRefs)
      .map((c) => `${c.start}:${c.end}:${c.kind}`)
      .join(",");
    if (oldChipsKey !== newChipsKey) {
      startPromptTransition(() => {
        setPromptByAgent((current) => {
          if (!value) {
            const next = { ...current };
            delete next[agentId];
            return next;
          }
          return { ...current, [agentId]: value };
        });
      });
    }
  }

  function getComposerTargetId() {
    return currentSessionIdRef.current ?? activeAgentIdRef.current;
  }

  function getLiveComposerPrompt() {
    const targetId = getComposerTargetId();
    return targetId
      ? (livePromptByAgentRef.current[targetId] ?? prompt)
      : prompt;
  }

  function setPrompt(value: string | ((current: string) => string)) {
    const targetId = getComposerTargetId();
    if (targetId) setPromptForAgent(targetId, value);
  }

  function setAttachedImagesForAgent(
    agentId: string,
    value: ImageContent[] | ((current: ImageContent[]) => ImageContent[]),
  ) {
    if (currentSessionIdRef.current === agentId || getSessionRecord(agentId)) {
      setSessionAttachments({ sessionId: agentId, value });
      return;
    }
    const current = attachedImagesByAgentRef.current;
    const previous = current[agentId] ?? [];
    const nextValue = typeof value === "function" ? value(previous) : value;
    const next = { ...current };
    if (nextValue.length === 0) delete next[agentId];
    else next[agentId] = nextValue;
    attachedImagesByAgentRef.current = next;
    setAttachedImagesByAgent(next);
  }

  function setAttachedImages(
    value: ImageContent[] | ((current: ImageContent[]) => ImageContent[]),
  ) {
    const targetId = getComposerTargetId();
    if (targetId) setAttachedImagesForAgent(targetId, value);
  }

  // Queue ownership extracted to useQueuedPrompt.
  const queue = useQueuedPrompt({
    runtimeStateByAgentRef,
    displayAgentsRef,
    activeAgentIdRef,
    queueFlushByAgentRef,
    composerTextareaRef,
    pendingComposerCaretRef,
    livePromptByAgentRef,
    store,
    promptByAgent,
    setPromptForAgent,
    setAttachedImagesForAgent,
    setComposerAgentModeForAgent,
    setComposerCursor,
    showToast,
    dispatchPromptSnapshot,
  });
  const activeQueuedPrompts = activeAgentId
    ? (queue.queuedPrompts[activeAgentId] ?? [])
    : [];

  const terminalDockState = activeAgentId
    ? terminalDockStateByAgent[activeAgentId]
    : undefined;
  // 终端打开/折叠状态按 agent 隔离,避免切换项目/agent 后丢失当前终端 UI 状态。
  const terminalOpen = Boolean(terminalDockState?.open);
  const terminalCollapsed = Boolean(terminalDockState?.collapsed);
  const terminalDockVisible =
    terminalDockMounted && terminalDockAgentId === activeAgentId;

  // 轨道尺寸只在开关时变更一次，终端本身用 transform 完成合成动画。
  // 关闭时保留组件至动画结束，避免同步销毁 xterm 阻塞第一帧。
  useEffect(() => {
    if (terminalOpen && activeAgentId) {
      if (terminalDockCloseTimerRef.current != null) {
        window.clearTimeout(terminalDockCloseTimerRef.current);
        terminalDockCloseTimerRef.current = null;
      }
      setTerminalDockAgentId(activeAgentId);
      setTerminalDockClosing(false);
      setTerminalDockMounted(true);
      return;
    }
    if (!terminalDockMounted) return;
    if (terminalDockAgentId !== activeAgentId) {
      setTerminalDockMounted(false);
      return;
    }

    setTerminalDockClosing(true);
    terminalDockCloseTimerRef.current = window.setTimeout(
      () => {
        setTerminalDockMounted(false);
        setTerminalDockClosing(false);
      },
      TERMINAL_DOCK_MOTION_MS,
    );
    return () => {
      if (terminalDockCloseTimerRef.current != null) {
        window.clearTimeout(terminalDockCloseTimerRef.current);
        terminalDockCloseTimerRef.current = null;
      }
    };
  }, [activeAgentId, terminalDockAgentId, terminalDockMounted, terminalOpen]);

  const drawerPinnedPanel = activeProjectId
    ? drawerPinnedByProject[activeProjectId]
    : undefined;
  const drawerPinned = Boolean(drawerPinnedPanel);
  const activeMessages = currentSessionId ? currentSessionMessages : [];
  const agentRuntimeState = activeAgentId
    ? activeProjectRuntimeCapabilities[activeAgentId]
    : undefined;
  const activeRuntimeState = currentSessionId
    ? (currentSessionRuntime?.state ?? (
      currentSession?.model || currentSession?.thinkingLevel
        ? {
            provider: currentSession.model?.provider,
            modelId: currentSession.model?.modelId,
            modelName: currentSession.model?.modelId,
            thinkingLevel: currentSession.thinkingLevel,
          }
        : undefined
    ))
    : agentRuntimeState;
  const activeConversationStatus = currentSessionId
    ? (currentSessionRuntime?.status ??
      (currentSessionSendState.status === "activating" ? "starting" : "idle"))
    : undefined;
  const hasActiveConversation = Boolean(currentSession);
  const isConversationLoading = Boolean(
    currentSessionId &&
    activeMessages.length === 0 &&
    (currentSessionMessagesLoading || currentSessionSendState.status === "activating"),
  );
  const currentSessionLiveAgentId =
    currentSessionRuntime?.agentId === activeAgentId &&
    activeAgent &&
    activeAgent.status !== "closed" &&
    activeAgent.status !== "error"
      ? activeAgent.id
      : undefined;
  const canMutateActiveMessages = Boolean(currentSessionLiveAgentId);
  const activeProjectHasBusyAgent = Boolean(
    activeProjectId && displayAgents.some((agent) =>
      agent.projectId === activeProjectId && (
        agent.status === "starting" ||
        agent.status === "running" ||
        activeProjectRuntimeCapabilities[agent.id]?.isStreaming ||
        activeProjectRuntimeCapabilities[agent.id]?.isExecutingTool
      ),
    ),
  );
  const activeProjectSessionSyncKey = useMemo(() => {
    if (!activeProjectId) return "";
    return displayAgents
      .filter((agent) => agent.projectId === activeProjectId)
      .map((agent) => {
        const runtime = activeProjectRuntimeCapabilities[agent.id];
        return `${agent.id}:${agent.status}:${runtime?.isStreaming ? 1 : 0}:${runtime?.isExecutingTool ? 1 : 0}`;
      })
      .sort()
      .join("|");
  }, [activeProjectId, activeProjectRuntimeCapabilities, displayAgents]);

  // 消息分页:超过 100 条消息时启用,大幅减少输入卡顿
  // 首屏 100 条,每次加载 100 条,一页一页懒加载
  const {
    visibleMessages: paginatedMessages,
    hasMore: hasMoreMessages,
    loadMore: loadMoreMessages,
    loadUntilIncluded: loadMessagesUntilIncluded,
    isLoading: isLoadingMoreMessages,
  } = useMessagePagination({
    messages: activeMessages,
    initialPageSize: 100, // 首屏 100 条
    pageSize: 100,        // 每次加载 100 条
    enabled: activeMessages.length > 100, // 超过 100 条才启用
  });

  function sendSessionUiResponse(requestId: string, response: AgentUiResponse) {
    if (!currentSessionId || !currentSessionRuntime) return;
    const input = {
      sessionId: currentSessionId,
      requestId,
      agentId: currentSessionRuntime.agentId ?? "",
      runtimeGeneration: currentSessionRuntime.runtimeGeneration,
    };
    const currentReq = currentSessionRuntimeUi?.requests[requestId];
    const request = currentReq?.request;
    if (!input.agentId || !request) return;
    // 若已被 overlay responder claim（status="responding"），跳过重复 claim，避免双 claim 死锁
    if (currentReq?.status !== "responding" && !claimSessionUiResponse({ ...input, request })) return;
    void api.sessions.sendUiResponse({ ...input, response }).catch((error) => {
      rollbackSessionUiResponse({ ...input, request });
      showToast(error instanceof Error ? error.message : String(error), 4000);
    });
  }
  // dialog 显示条件：仅当有活跃的交互式 UI 请求时

  const lastSessionUiNoticeRef = useRef("");
  useEffect(() => {
    const notification = currentSessionRuntimeUi?.notification;
    if (!currentSessionId || !notification) return;
    const key = `${currentSessionId}:${currentSessionRuntimeUi.runtimeGeneration}:${notification.revision}`;
    if (lastSessionUiNoticeRef.current === key) return;
    lastSessionUiNoticeRef.current = key;
    showNotice(
      notification.message,
      notification.notifyType === "error" ? 5000 : 3500,
    );
  }, [currentSessionId, currentSessionRuntimeUi]);

  const lastSessionEditorTextRef = useRef("");
  useEffect(() => {
    const editorText = currentSessionRuntimeUi?.editorText;
    if (!currentSessionId || !editorText) return;
    const key = `${currentSessionId}:${currentSessionRuntimeUi.runtimeGeneration}:${editorText.revision}`;
    if (lastSessionEditorTextRef.current === key) return;
    lastSessionEditorTextRef.current = key;
    setPromptForAgent(currentSessionId, editorText.text);
    setComposerCursor(editorText.text.length);
    pendingComposerCaretRef.current = editorText.text.length;
  }, [currentSessionId, currentSessionRuntimeUi]);

  useEffect(() => {
    if (!activeWidgetSessionKey || !currentSessionRuntimeUi) return;
    const widgetKeys = Object.keys(currentSessionRuntimeUi.widgets);
    if (widgetKeys.length === 0) return;
    setAgentDismissedWidgets((current) => {
      const dismissed = current[activeWidgetSessionKey];
      if (!dismissed?.some((key) => widgetKeys.includes(key))) return current;
      return {
        ...current,
        [activeWidgetSessionKey]: dismissed.filter((key) => !widgetKeys.includes(key)),
      };
    });
  }, [activeWidgetSessionKey, currentSessionRuntimeUi?.revision]);

  /** 当前 Session 的实时思考文本只来自 generation envelope。 */
  const activeThinking = currentSessionRuntime?.thinking ?? "";
  const activeTerminalHeight = activeAgentId
    ? (terminalHeightByAgent[activeAgentId] ?? COMPOSER_DEFAULT_TERMINAL_HEIGHT)
    : COMPOSER_DEFAULT_TERMINAL_HEIGHT;
  const requestedTerminalRowHeight =
    !terminalDockVisible || terminalDockClosing
      ? 0
      : terminalCollapsed
        ? 34
        : activeTerminalHeight;
  const chatPaneHeight = chatLayoutHeight;
  const chatHeaderHeight = chatHeaderRef.current?.offsetHeight ?? 78;
  const fixedChatHeight =
    chatHeaderHeight +
    COMPOSER_MIN_TIMELINE_HEIGHT +
    COMPOSER_MIN_HEIGHT +
    28;
  // Queue chrome includes the track gap, panel padding/header/border, and complete rows.
  // Keep this in sync with .queued-list so the third row is never clipped by the composer.
  const queuedChromeBudget =
    activeQueuedPrompts.length > 0
      ? 38 + Math.min(activeQueuedPrompts.length, QUEUED_PROMPT_VISIBLE) * 34
      : 0;
  const terminalRowHeight = terminalCollapsed
    ? requestedTerminalRowHeight
    : Math.min(
        requestedTerminalRowHeight,
        Math.max(0, chatPaneHeight - fixedChatHeight - queuedChromeBudget),
      );
  const visibleQueuedPrompts = activeQueuedPrompts;
  const resolvedComposerHeight = Math.min(
    getComposerMaxHeight(),
    Math.max(composerHeight, composerAutoHeight),
  );
  // composerMode 基于 composerBangMode（state）而非 prompt（ref），避免每键触发重渲染。
  // composerBangMode 仅在 ! / !! 前缀真正变化时更新。
  const composerMode = composerBangMode === "bang-bang"
    ? "silent-shell"
    : composerBangMode === "bang"
      ? "shell"
      : currentComposerAgentMode === "plan"
        ? "plan"
        : null;
  const composerStatusText =
    composerMode === "silent-shell"
      ? t("app.composerSilentStatus")
      : composerMode === "shell"
        ? t("app.composerShellStatus")
        : composerMode === "plan"
          ? t("app.composerPlanStatus")
          : drawer === "files"
          ? t("app.composerFilesStatus")
          : drawer === "sessions"
            ? t("app.composerSessionStatus", {
                name: sessionsProject?.name ?? t("common.project"),
              })
            : (activeAgent?.sessionPath ?? "");

  useEffect(() => {
    if (!drawerPinnedPanel) return;
    if (drawer !== drawerPinnedPanel) setDrawer(drawerPinnedPanel);
    if (drawerCollapsed) setDrawerCollapsed(false);
  }, [drawer, drawerCollapsed, drawerPinnedPanel]);

  useEffect(() => {
    document.documentElement.lang = resolvedLocale;
  }, [resolvedLocale]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme =
        settings.theme === "system"
          ? media?.matches
            ? "dark"
            : "light"
          : settings.theme;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.lightBackground = settings.lightBackground;
    };
    applyTheme();
    if (settings.theme !== "system" || !media) return;
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [settings.theme, settings.lightBackground]);

  // 字号与命名字体预设由 data 属性选择 CSS token；只有 custom 字体需要注入用户输入。
  useEffect(() => {
    const root = document.documentElement;
    const uiFontSize = settings.uiFontSize ?? settings.fontSize;
    const chatFontSize = settings.chatFontSize ?? settings.fontSize;
    const inputFontSize = settings.inputFontSize ?? settings.fontSize;
    root.dataset.uiFontSize = uiFontSize;
    root.dataset.chatFontSize = chatFontSize;
    root.dataset.inputFontSize = inputFontSize;
    // 旧属性保留，兼容外部依赖或测试仍读取 dataset.fontSize 的场景
    root.dataset.fontSize = settings.fontSize;
    root.dataset.fontBase = settings.fontFamilyBase;
    root.dataset.fontMono = settings.fontFamilyMono;

    const baseCustomFont = settings.fontFamilyBaseCustom.trim();
    if (settings.fontFamilyBase === "custom" && baseCustomFont) {
      root.style.setProperty("--font-family-base", baseCustomFont);
    } else {
      root.style.removeProperty("--font-family-base");
    }

    const monoCustomFont = settings.fontFamilyMonoCustom.trim();
    if (settings.fontFamilyMono === "custom" && monoCustomFont) {
      root.style.setProperty("--font-family-mono", monoCustomFont);
    } else {
      root.style.removeProperty("--font-family-mono");
    }
  }, [
    settings.fontSize,
    settings.uiFontSize,
    settings.chatFontSize,
    settings.inputFontSize,
    settings.fontFamilyBase,
    settings.fontFamilyBaseCustom,
    settings.fontFamilyMono,
    settings.fontFamilyMonoCustom,
  ]);

  /** 当前会话中 agent 修改过的文件(从 tool 消息 meta 中提取) */
  // 优化:只在消息数量变化时才重新计算,减少不必要的遍历
  const modifiedFiles = useMemo(() => {
    const byPath = new Map<string, SessionModifiedFile>();
    for (const msg of activeMessages) {
      if (msg.role !== "tool") continue;
      const toolName: string | undefined = msg.meta?.toolName as
        | string
        | undefined;
      const args: any = msg.meta?.args;
      const status: string = String(msg.meta?.status ?? "done");
      // 只收集文件写入/编辑类的工具调用，作为右侧 Files 与会话结束摘要的统一数据源。
      if (!toolName || !/write|edit|create|patch/i.test(toolName)) continue;
      const filePath = getToolFilePath(args);
      if (!filePath) continue;
      const previous = byPath.get(filePath);
      // 同一路径再次被修改时移动到 Map 末尾，右侧修改清单才能按"最新修改"展示。
      if (previous) byPath.delete(filePath);
      // originalContent 不再存储到消息 meta 中（full file 会使会话体积过大）。
      // diff 展示时使用工具参数（oldText/newText）显示变动区域。
      byPath.set(filePath, {
        path: filePath,
        toolName,
        status: status === "running" ? "running" : (previous?.status ?? status),
        changedLines:
          (previous?.changedLines ?? 0) +
          getToolChangedLineCount(toolName, args),
        originalContent: "",
        content: getToolNewContent(toolName, args) ?? previous?.content,
      });
    }
    return Array.from(byPath.values());
  }, [activeMessages.length, activeAgentId]);
  // 优化:轮廓项计算仅在消息数量变化时触发,减少不必要的重计算
  const outlineItems = useMemo(
    () => buildOutline(activeMessages),
    [activeMessages.length, activeAgentId],
  );
  const flatFiles = useMemo(() => flattenFiles(files), [files]);
  // === file editor hook ===
  const {
    editorMode,
    toggleEditorMode,
    editorTabs,
    activeTabId,
    activeTab,
    readEditorFileContent,
    readEditorOriginalContent,
    saveEditorFileContent,
    closeEditorTab,
    selectEditorTab,
    openFilePath,
    viewFilePath,
    diffFilePath,
    openWorkspaceFileDiff,
    openCommitFileDiff,
    closeGitDiff,
    gitDiffDisplayMode,
    gitDrawerDiff,
    toggleGitDiffDisplayMode,
    prevDrawerPanelRef,
    clearEditorBack,
    closeEditor,
  } = useFileEditor({
    activeProjectId,
    activeProjectIdRef,
    activeAgent: activeAgent ?? null,
    activeProject: activeProject ?? null,
    drawer,
    modifiedFiles,
    setDrawer,
    setDrawerCollapsed,
    showToast,
    readFileContent: api.files.readContent,
    readGitOriginalContent: api.git.originalContent,
    writeFileContent: api.files.writeContent,
    openFile: api.files.open,
    workspaceFileDiff: api.git.workspaceFileDiff,
    commitFileDiff: api.git.commitFileDiff,
    t,
  });

  // 优化:建议项计算仅在必要时触发,避免每次输入都重计算导致卡顿
  // 只有当建议框打开时才计算,关闭时返回空数组
  const activeProjectSessions = useAtomValue(
    sessionSummariesByProjectIdAtomFamily(activeProjectId ?? ""),
  );

  const {
    selectProject: selectProjectCommand,
    selectSession: selectSessionCommand,
    copySession: runCopySession,
    exportHistorySession: runExportHistorySession,
    deleteHistorySession: runDeleteHistorySession,
    openSidebarSession: runOpenSidebarSession,
    openSidebarSessionById: runOpenSidebarSessionById,
    copySidebarSession: runCopySidebarSession,
    exportSidebarSession: runExportSidebarSession,
    createSessionDraft: runCreateSessionDraft,
  } = useSessionActions({
    openSessionRequestRef,
    creatingSessionDraftRef,
    autoScrollRef,
    composerTextareaRef,
    activeProjectId,
    sessionsProjectId,
    projects,
    activeProjectSessions,
    sessionRefSelections,
    setActiveProjectId,
    setCurrentSessionId,
    setAutoScroll,
    setSessionRefSelections,
    getSessionRecord,
    getProjectSessionRecords,
    upsertSession,
    removeSessionState,
    removeSessionComposerState,
    refreshProjectSessions,
    api,
    showToast,
  });

  const suggestionItems = useMemo(
    () =>
      suggestionsOpen
        ? buildSuggestionItems(prompt, composerCursor, commands, flatFiles, activeProjectSessions)
        : [],
    [suggestionsOpen, prompt, composerCursor, commands, flatFiles, activeProjectSessions],
  );

  /** 有效命令名白名单：仅已知命令渲染为 chip */
  const mergedCommands = useMemo(
    () => mergeCommands(commands),
    [commands],
  );
  const validCommandNames = useMemo(
    () => new Set([
      ...mergedCommands.map((c) => c.name),
      ...promptTemplateList.map((t) => t.name),
    ]),
    [mergedCommands, promptTemplateList],
  );

  /** 有效文件路径白名单：仅工作区真实存在的 @ 引用渲染为 chip */
  const validFilePaths = useMemo(
    () => new Set(flatFiles.map((f) => f.relativePath)),
    [flatFiles],
  );

  const validSessionRefs: Set<string> = useMemo(
    () => new Set(activeProjectSessions.map((s) => s.name ?? s.filePath)),
    [activeProjectSessions],
  );

  /** 菜单光标锚定位置（屏幕坐标），仅在 suggestionsOpen 时计算。 */
  const suggestionAnchorStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!suggestionsOpen) return undefined;
    const root = composerTextareaRef.current;
    if (!root) return undefined;
    const coords = getRichInputCaretCoords(root, composerCursor);
    if (!coords) return undefined;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = Math.min(520, vw - 120);
    const menuH = 380;
    const gap = 8;

    // 水平：光标左对齐，超出则右贴边
    let left = coords.left;
    if (left + menuW > vw - 16) left = Math.max(16, vw - menuW - 16);

    // 垂直：优先光标下方，空间不够则上方
    const belowTop = coords.top + gap;
    const aboveBottom = coords.top - gap;
    if (belowTop + menuH <= vh - 16) {
      return { top: belowTop, left, bottom: "auto", transform: "none" };
    }
    if (aboveBottom - menuH >= 0) {
      return { top: "auto", bottom: vh - aboveBottom, left, transform: "none" };
    }
    return { top: "auto", bottom: 16, left, transform: "none" };
  }, [suggestionsOpen, composerCursor]);
  const visibleAgents = useMemo(
    () =>
      displayAgents.filter((agent) =>
        matches(agent.title + agent.cwd + (agent.sessionId ?? ""), search),
      ),
    [displayAgents, search],
  );
  const filteredAgents = visibleAgents;
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        // worktree 子项目不显示在主列表中，只在父项目下以子项展示
        if (project.worktreeParentId) return false;
        const projectSessions = getProjectSessions(project.id);
        return (
          matches(project.name + project.path, search) ||
          displayAgents.some(
            (agent) =>
              agent.projectId === project.id &&
              matches(
                agent.title + agent.cwd + (agent.sessionId ?? ""),
                search,
              ),
          ) ||
          projectSessions.some((session) =>
            matches(
              `${session.name ?? ""}${session.preview}${session.filePath}`,
              search,
            ),
          )
        );
      }),
    [displayAgents, projects, search],
  );
  const projectIdsKey = useMemo(
    () => projects.map((project) => project.id).join("\n"),
    [projects],
  );
  const canReorderProjects = search.trim().length === 0;

  function handleAgentInventoryChanged(nextAgents: AgentTab[]) {
    const previousPendingAgents = pendingAgentsRef.current;
    const remainingPendingAgents = previousPendingAgents.filter(
      (pending) => !nextAgents.some((agent) =>
        isReplacementForPendingAgent(agent, pending),
      ),
    );
    const pendingReplacementById = new Map(
      previousPendingAgents
        .map((pending) => {
          const replacement = nextAgents.find((agent) =>
            isReplacementForPendingAgent(agent, pending),
          );
          return replacement ? [pending.id, replacement.id] : undefined;
        })
        .filter((entry): entry is [string, string] => Boolean(entry)),
    );
    if (remainingPendingAgents.length !== previousPendingAgents.length) {
      pendingAgentsRef.current = remainingPendingAgents;
      setPendingAgents(remainingPendingAgents);
    }
    const activeIds = new Set(nextAgents.map((agent) => agent.id));
    const activeProjectIds = new Set(nextAgents.map((agent) => agent.projectId));
    const draftIds = new Set([
      ...nextAgents.map((agent) => agent.id),
      ...remainingPendingAgents.map((agent) => agent.id),
    ]);
    setTerminalDockStateByAgent((current) =>
      pruneTerminalDockState(current, activeIds),
    );
    setTerminalHeightByAgent((current) => Object.fromEntries(
      Object.entries(current).filter(([agentId]) => activeIds.has(agentId)),
    ));
    setDrawerPinnedByProject((current) => Object.fromEntries(
      Object.entries(current).filter(([projectId]) => activeProjectIds.has(projectId)),
    ));
    setPromptByAgent((current) => {
      const next = migrateAgentRecord(current, pendingReplacementById, draftIds);
      livePromptByAgentRef.current = migrateAgentRecord(
        livePromptByAgentRef.current,
        pendingReplacementById,
        draftIds,
      );
      return next;
    });
    setAttachedImagesByAgent((current) =>
      migrateAgentRecord(current, pendingReplacementById, draftIds),
    );
    queue.updateQueuedPrompts((current) =>
      migrateQueuedPrompts(current, pendingReplacementById, draftIds),
    );
    for (const [oldAgentId] of pendingReplacementById) {
      queueFlushByAgentRef.current.delete(oldAgentId);
    }
    for (const agentId of queueFlushByAgentRef.current) {
      if (!draftIds.has(agentId)) queueFlushByAgentRef.current.delete(agentId);
    }
  }

  useGlobalAgentListeners({
    onProjectsChanged: (next) => {
      if (!activeProjectId && next.length > 0) setActiveProjectId(next[0].id);
    },
    onAgentInventoryChanged: handleAgentInventoryChanged,
    onRuntimeCapabilityChanged: ({ agentId, previous, current, patch }) => {
      runtimeStateByAgentRef.current = {
        ...runtimeStateByAgentRef.current,
        [agentId]: current,
      };
      if (
        previous?.isExecutingTool &&
        !current.isExecutingTool &&
        (patch.toolStateSequence == null ||
          previous.toolStateSequence == null ||
          patch.toolStateSequence >= previous.toolStateSequence) &&
        queue.isAgentCurrentlyBusy(agentId)
      ) {
        void queue.flushQueuedSteerPrompts(agentId);
      }
    },
    onAgentLog: (payload) => {
      setLogs((current) => {
        const nextLog = `[${payload.agentId.slice(0, 8)}] ${payload.text}`;
        return current.length < 200
          ? [...current, nextLog]
          : [...current.slice(-199), nextLog];
      });
    },
    onSettingsApplied: (next) => {
      setSettings(next);
      showToast(t("settings.restartNotice"));
    },
    onUpdateProgress: (progress) => {
      setUpdateProgress(progress);
      if (progress.state === "completed") {
        setUpdateDownloading(false);
        setDownloadedUpdatePath(progress.filePath ?? null);
      } else if (progress.state === "failed") {
        setUpdateDownloading(false);
        setUpdateError(progress.error ?? t("update.downloadFailed"));
      }
    },
    onOpenInBrowser: (url) => {
      setDrawer("browser");
      setDrawerCollapsed(false);
      navigateTo(url);
    },
    onTrustRequest: setTrustRequest,
    onFocusTarget: (target) => {
      const agent = displayAgentsRef.current.find((item) => item.id === target.agentId);
      if (!agent) return;
      const sessionId = store.get(
        sessionIdByRuntimeAgentIdAtomFamily(target.agentId),
      );
      if (sessionId) {
        selectSessionCommand(agent.projectId, sessionId, false);
      } else {
        selectProjectCommand(agent.projectId);
      }
    },
  });

  useEffect(() => {
    void api.editors.list().then(setExternalEditors).catch(() => undefined);
    void api.app
      .preferredSystemLanguages()
      .then((languages) => setSystemLanguage(languages.find((language) => typeof language === "string" && language.trim()) ?? null))
      .catch(() => setSystemLanguage(null));
    void api.app
      .info()
      .then(setAppInfo)
      .catch(() => undefined);
    void api.settings.get().then((next) => {
      setSettings(next);
      piUpdate.setCustomPiPath(next.customPiPath ?? "");
      if (!Object.values(next.externalEditors).some((editor) => editor.command)) {
        void api.editors
          .redetect()
          .then((updated) => {
            setSettings(updated);
            return api.editors.list();
          })
          .then(setExternalEditors)
          .catch(() => undefined);
      }
      if (!next.piEnvironmentChecked) {
        // 首次检测延后一帧启动,先让主界面完成绘制,避免 packaged app 打开时出现几秒白屏。
        window.setTimeout(() => void piUpdate.checkPiInstall("startup"), 300);
      }
      if (!next.disableUpdateCheck) {
        window.setTimeout(() => void piUpdate.checkPiCliUpdateOnStartup(), 1200);
      }
    });

  }, []);

  useEffect(() => {
    const projectIds = new Set(projects.map((project) => project.id));
    setVisibleProjectChildCountByProject((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) =>
          projectIds.has(projectId),
        ),
      ),
    );
    setSessionLoadingByProject((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) =>
          projectIds.has(projectId),
        ),
      ),
    );
    // 启动时只加载 chat 项目的会话,其他项目延迟到展开时加载
    for (const project of projects) {
      if (project.kind === "chat") {
        void refreshProjectSessions(project.id).catch(() => undefined);
      }
    }
  }, [projectIdsKey]);

  useEffect(() => {
    // 当禁用版本检测时，不启动定时和启动后的自动检测
    if (settings.disableUpdateCheck) return;
    const timer = window.setInterval(
      () => void checkAppUpdate("auto"),
      1000 * 60 * 60 * 6,
    );
    window.setTimeout(() => void checkAppUpdate("auto"), 5000);
    return () => window.clearInterval(timer);
  }, [settings.disableUpdateCheck]);

  useEffect(() => {
    if (activeAgentId && !isPendingAgentId(activeAgentId))
      void refreshRuntimeState(activeAgentId);
  }, [activeAgentId]);

  useEffect(() => {
    const activeIds = new Set(displayAgents.map((agent) => agent.id));
    setTerminalDockStateByAgent((current) =>
      pruneTerminalDockState(current, activeIds),
    );
  }, [displayAgents]);

  useEffect(() => {
    if (!activeProjectId || collapsedProjects.has(activeProjectId)) return;
    // 进入/退出运行态时都立即扫描一次，保证最终 child session 不因最后一次写入时序而遗漏。
    let disposed = false;
    const scheduleRefresh = () => {
      if (disposed) return;
      void refreshProjectSessions(activeProjectId, true).catch(() => undefined);
    };
    scheduleRefresh();
    if (!activeProjectHasBusyAgent) {
      return () => { disposed = true; };
    }

    // pi-subagents 会在 Agent 运行期间直接向 sessions 目录写入子会话，主进程没有文件变更事件。
    // 仅在当前项目运行期间低频扫描，兼顾实时嵌套与 WSL/大历史目录的 IO 成本。
    const timer = window.setInterval(scheduleRefresh, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeProjectId, activeProjectHasBusyAgent, activeProjectSessionSyncKey, collapsedProjects]);

  function getComposerMaxHeight() {
    const chatPane = chatPaneRef.current;
    const header = chatHeaderRef.current;
    const composer = composerRef.current;
    const box = composerBoxRef.current;
    if (!chatPane || !header || !composer || !box) {
      const reservedTerminalHeight = terminalRowHeight;
      return Math.max(
        180,
        window.innerHeight -
          78 -
          COMPOSER_MIN_TIMELINE_HEIGHT -
          52 -
          reservedTerminalHeight,
      );
    }

    const reservedTerminalHeight = terminalRowHeight;
    const composerChrome = Math.max(
      0,
      composer.offsetHeight - box.offsetHeight,
    );
    // 输入框最大高度取决于聊天区域还剩多少可用空间,而不是固定视口比例;
    // 否则窗口变窄后软换行变多,最小窗口下会比内容需要的高度更早触顶。
    return Math.max(
      180,
      chatPane.clientHeight -
        header.offsetHeight -
        COMPOSER_MIN_TIMELINE_HEIGHT -
        reservedTerminalHeight -
        composerChrome,
    );
  }

  function clampComposerHeight(height: number) {
    const maxHeight = getComposerMaxHeight();
    return Math.min(maxHeight, Math.max(COMPOSER_MIN_HEIGHT, height));
  }

  function ensureComposerTailVisible() {
    const editor = composerTextareaRef.current;
    if (!editor || document.activeElement !== editor) return;
    // RichInput 用纯文本偏移表示光标;光标在末尾时同步滚动到底,行为与原 textarea 一致。
    const len = editor.textContent?.length ?? 0;
    const atEnd = getCaretOffsetOf(editor) >= len;
    if (!atEnd) return;
    requestAnimationFrame(() => {
      const current = composerTextareaRef.current;
      if (!current) return;
      current.scrollTop = current.scrollHeight;
    });
  }

  function syncComposerAutoHeight() {
    const box = composerBoxRef.current;
    const editor = composerTextareaRef.current;
    if (!box || !editor) return;

    // 宽度变化会改变软换行位置,编辑区的 scrollHeight 才是当前内容真实需要的高度。
    // 这里减去 chrome 高度(顶部留白/工具条/底部状态条),把问题修在布局源头而不是靠用户手动拖。
    const chromeHeight = box.offsetHeight - editor.clientHeight;
    const nextHeight = clampComposerHeight(
      editor.scrollHeight + chromeHeight,
    );
    setComposerAutoHeight((current) =>
      Math.abs(current - nextHeight) <= 1 ? current : nextHeight,
    );
    ensureComposerTailVisible();
  }

  // 待发送轨道高度变化会改变 composer 的 chrome 高度；队列增删后重新 clamp，
  // 保证大量卡片出现时输入框仍留在可视区域，撤回后也不会保留过高尺寸。
  useLayoutEffect(() => {
    const maxHeight = getComposerMaxHeight();
    setComposerHeight((current) => Math.min(current, maxHeight));
    setComposerAutoHeight((current) => Math.min(current, maxHeight));
  }, [activeAgentId, activeQueuedPrompts.length]);

  function scrollToBottom() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    programmaticScrollRef.current = true;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
    setAutoScroll(true);
    autoScrollRef.current = true;
    setShowScrollToBottom(false);
  }

  // 给定位命中的消息元素加一个短暂的高亮动画，方便用户在长会话中快速识别跳转落点。
  function highlightMessageElement(el: HTMLElement) {
    el.classList.remove("message-jump-highlight");
    // 强制 reflow 以便重复跳转同一条消息时仍能重新触发动画。
    void el.offsetWidth;
    el.classList.add("message-jump-highlight");
    window.setTimeout(() => el.classList.remove("message-jump-highlight"), 2000);
  }

  // 点击“加载更多历史消息”：先记录当前滚动锚点，再触发分页加载，
  // 渲染后的 effect 会根据新增高度补偿 scrollTop，保持视图稳定。
  function handleLoadMoreMessages() {
    const timeline = timelineRef.current;
    if (timeline) {
      loadMoreAnchorRef.current = {
        height: timeline.scrollHeight,
        top: timeline.scrollTop,
      };
    }
    loadMoreMessages();
  }

  // 会话定位跳转：若目标消息已在当前分页内则直接滚动定位；
  // 否则先扩展分页窗口把它包含进来，交给 pendingJumpId effect 在渲染后定位。
  function handleOutlineJump(id: string) {
    const el = document.querySelector(
      `[data-message-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      highlightMessageElement(el);
      return;
    }
    const index = activeMessages.findIndex((m) => m.id === id);
    if (index < 0) return;
    loadMessagesUntilIncluded(index);
    setPendingJumpId(id);
  }

  useEffect(() => {
    let frame = 0;
    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setComposerHeight((current) => clampComposerHeight(current));
        setComposerOffsetHeight(composerRef.current?.offsetHeight ?? 0);
        setChatLayoutHeight((current) => {
          const next = chatPaneRef.current?.clientHeight ?? window.innerHeight;
          return current === next ? current : next;
        });
      });
    };

    const box = composerBoxRef.current;
    const footer = composerRef.current;
    const chatPane = chatPaneRef.current;
    const observer =
      (box || footer || chatPane) &&
      new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        scheduleSync();
      });
    if (box) observer?.observe(box);
    if (footer) observer?.observe(footer);
    if (chatPane) observer?.observe(chatPane);

    window.addEventListener("resize", scheduleSync);
    scheduleSync();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleSync);
      observer?.disconnect();
    };
  }, [activeAgentId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setComposerHeight((current) => clampComposerHeight(current));
      setComposerOffsetHeight(composerRef.current?.offsetHeight ?? 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    prompt,
    activeAgentId,
    listCollapsed,
    drawerCollapsed,
    drawer,
    terminalOpen,
    activeTerminalHeight,
  ]);

  useEffect(() => {
    if (activeAgentId && !isPendingAgentId(activeAgentId))
      void api.agents
        .commands(activeAgentId)
        // goal 模式这版先不公开入口；保留底层实现,等待官方 plan/goal 能力稳定后再决定是否恢复。
        .then((cmds) => setCommands(cmds))
        .catch(() => setCommands([]));
    else setCommands([]);
  }, [activeAgentId]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestionItems.length]);

  // 持久化会话来源过滤配置
  useEffect(() => {
    try {
      saveSessionSourceFilter(sessionSourceFilter);
    } catch (error) {
      // 静默失败
    }
  }, [sessionSourceFilter]);

  // 切换 Agent 时重置滚动状态，确保回到该 Agent 时自动滚到底部。
  // 历史命令已由当前分支按 Agent 隔离，不恢复 dev 旧的全局 commandHistory 持久化。
  useEffect(() => {
    setAutoScroll(true);
    autoScrollRef.current = true;
    setShowScrollToBottom(false);
    const frame = requestAnimationFrame(() => {
      const timeline = timelineRef.current;
      if (timeline) {
        programmaticScrollRef.current = true;
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeAgentId]);

  // 监听用户滚动,判断是否需要显示"移动到最新"按钮
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = timeline;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

      // 程序触发的滚动（ResizeObserver / scrollToBottom 等）只允许开启 autoScroll，
      // 不允许关闭。防止竞态：scrollTo(bottom) 后、scroll 事件触发前，scrollHeight
      // 可能已大幅变化（思考块折叠、代码块/工具输出出现），导致误判为"用户滚离了底部"。
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        if (isAtBottom) {
          setAutoScroll(true);
          autoScrollRef.current = true;
          setShowScrollToBottom(false);
        }
        // 非底部也不关 autoScroll — 交给后续事件重新判断。
        return;
      }

      if (isAtBottom) {
        setAutoScroll(true);
        autoScrollRef.current = true;
        setShowScrollToBottom(false);
      } else {
        setAutoScroll(false);
        // 同步更新 ref，确保 ResizeObserver 回调在 React 状态更新生效前读到最新值，
        // 避免用户已滚到上方但 DOM 增长触发的 observer 因闭包旧值抢滚动到底部。
        autoScrollRef.current = false;
        setShowScrollToBottom(true);
      }
    };

    // 初始化时检查一次
    handleScroll();

    timeline.addEventListener("scroll", handleScroll);
    return () => timeline.removeEventListener("scroll", handleScroll);
  }, [activeAgentId]);

  // 用 ResizeObserver 监控消息列表内容的 DOM 高度变化，自动滚动到底部。
  // 流式回答时最后一条 assistant 消息原地增长但 messages.length 不变，
  // 依赖 length 的 effect 不会及时触发；通过 ResizeObserver 准确感知容器扩张。
  // autoScroll 在依赖中确保开关变化时重建 observer（同时触发一次初始滚动）。
  // activeAgent?.status 让 agent 从 starting→idle/errored 时重建 observer
  // 并触发一次滚动，解决状态切换后才出现 .message-list 时不会自动滚到底部的问题。
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const messageList = timeline.querySelector(".message-list");
    if (!messageList) return;

    // 使用 ref 而非闭包值，防止 DOM 变化与 React 状态更新之间的时序间隙造成滚动抢跑：
    // 用户已滚到上方（autoScroll=false），但状态更新尚未生效，observer 闭包中的 autoScroll 仍为 true。
    const scrollIfNeeded = () => {
      if (!autoScrollRef.current) return;
      programmaticScrollRef.current = true;
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
    };
    // 重建 observer 时先主动滚一次，处理 autoScroll 从 false→true 但列表高度未变的场景。
    scrollIfNeeded();

    const resizeObserver = new ResizeObserver(scrollIfNeeded);
    resizeObserver.observe(messageList);

    return () => resizeObserver.disconnect();
  }, [activeAgentId, autoScroll, activeAgent?.status]);

  // 加载更多历史消息后，按顶部锁定的方式恢复滚动位置。
  // 历史消息会插入到 .message-list 顶部，若不补偿新增高度，浏览器保持原 scrollTop 会导致视图跳动，
  // 用户会感觉输入框/内容错位。这里把新增高度增量加回 scrollTop，让当前看到的消息留在原位。
  // 使用 useLayoutEffect 在浏览器绘制前同步补偿，避免用户看到中间跳动的一帧。
  useLayoutEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) return;
    const el = timelineRef.current;
    if (!el) return;
    const delta = el.scrollHeight - anchor.height;
    if (delta !== 0) el.scrollTop = anchor.top + delta;
    loadMoreAnchorRef.current = null;
  }, [paginatedMessages.length]);

  // 会话定位跳转到尚未加载的消息时，先通过 loadMessagesUntilIncluded 扩展分页窗口；
  // 该消息被渲染进 DOM 后，在此 effect 中真正滚动定位并短暂高亮，提示用户落点。
  useEffect(() => {
    if (!pendingJumpId) return;
    const el = document.querySelector(
      `[data-message-id="${CSS.escape(pendingJumpId)}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightMessageElement(el);
    setPendingJumpId(null);
  }, [pendingJumpId, paginatedMessages.length]);

  // 追踪 agent 会话开始/结束时间,计算会话时长
  // 点击外部区域自动关闭会话组合下拉
  useEffect(() => {
    if (!sessionActionsOpen) return;
    const handler = (event: MouseEvent) => {
      if (sessionComboRef.current && !sessionComboRef.current.contains(event.target as Node)) {
        setSessionActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sessionActionsOpen]);

  useEffect(() => {
    for (const agent of displayAgents) {
      if (agent.id !== activeAgentId) continue;
      const previousStatus = agentStatusByAgentRef.current[agent.id];
      if (agent.status === "running") {
        if (previousStatus !== "running") {
          sessionStartByAgentRef.current[agent.id] = Date.now();
        }
      } else if (agent.status === "idle") {
        const start = sessionStartByAgentRef.current[agent.id];
        if (start) {
          setSessionDurationByAgent((d) => ({
            ...d,
            [agent.id]: Date.now() - start,
          }));
        }
      }
      agentStatusByAgentRef.current[agent.id] = agent.status;
    }
  }, [activeAgentId, displayAgents, modifiedFiles]);

  // 已删除内置 goal 完成检测。

  // 监听用户发送消息的编辑事件,将消息填入输入框
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail;
      if (detail?.text) {
        setPrompt(detail.text);
        // 光标移至文本末尾，利用 RichInput 的 caretRef 机制在渲染后恢复
        pendingComposerCaretRef.current = detail.text.length;
        requestAnimationFrame(() => {
          composerTextareaRef.current?.focus();
        });
      }
    };
    window.addEventListener("user-message-edit", handler);
    return () => window.removeEventListener("user-message-edit", handler);
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setFiles([]);
      setGitInfo({ current: null, branches: [] });
      return;
    }

    // 切换项目时,如果该项目未加载过会话,则加载
    const activeProject = projects.find((p) => p.id === activeProjectId);
    const hasLoadedSessions = getProjectSessions(activeProjectId).length > 0;
    const isLoadingNow = sessionLoadingByProject[activeProjectId];

    if (activeProject && !activeProject.kind && !hasLoadedSessions && !isLoadingNow) {
      void refreshProjectSessions(activeProjectId).catch(() => undefined);
    }

    setExpandedDirs(new Set());
    void api.files
      .list(activeProjectId)
      .then(setFiles)
      .catch((error) => setLogs((current) => [...current, String(error)]));
    void api.git
      .branches(activeProjectId)
      .then(setGitInfo)
      .catch(() => setGitInfo({ current: null, branches: [] }));
  }, [activeProjectId, currentSessionId, displayAgents.length]);

  useEffect(() => {
    if (!activeProjectId) return;
    let stopped = false;
    const refreshGitInfo = async () => {
      try {
        // 轮询分支信息
        const next = await api.git.branches(activeProjectId);
        if (stopped) return;
        // 分支可能在外部终端/IDE 中切换,轮询只在状态真的变化时更新,避免不必要重渲染。
        setGitInfo((current) =>
          current.current === next.current &&
          current.branches.join("\n") === next.branches.join("\n")
            ? current
            : next,
        );
      } catch {
        if (!stopped) {
          setGitInfo({ current: null, branches: [] });
        }
      }
    };
    const timer = window.setInterval(refreshGitInfo, 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeProjectId]);

  /** 统一通知：所有非模态消息都走 app-notice 位置 */
  function showToast(message: string, duration = 3500) {
    showNotice(message, duration);
  }

  async function downloadAppUpdate() {
    const asset = updateInfo?.recommendedAsset;
    if (!asset) {
      await api.app.openExternal(updateInfo?.releaseUrl ?? appInfo.releasesUrl);
      return;
    }
    setUpdateDownloading(true);
    setDownloadedUpdatePath(null);
    setUpdateProgress({
      assetName: asset.name,
      receivedBytes: 0,
      totalBytes: asset.size,
      percent: 0,
      state: "downloading",
    });
    try {
      const result = await api.app.downloadUpdate(asset);
      setDownloadedUpdatePath(result.filePath);
      showToast(t("update.downloadCompleted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateError(message);
      showToast(t("update.downloadFailed"));
    } finally {
      setUpdateDownloading(false);
    }
  }

  async function checkAppUpdate(source: "auto" | "manual" = "manual") {
    if (updateChecking) return;
    if (source === "auto" && settings.disableUpdateCheck) return;
    setUpdateChecking(true);
    try {
      const next = await api.app.checkUpdate();
      if (next.hasUpdate) {
        setUpdateInfo(next);
      } else if (source === "manual") {
        // 手动检查且无更新时,显示模态框提示
        setUpToDateVersion(next.currentVersion);
        showToast(
          t("app.latestVersionNotice", { version: next.currentVersion }),
        );
      }
    } catch (error) {
      if (source === "manual") {
        const message = error instanceof Error ? error.message : String(error);
        showToast(t("app.updateFailedNotice", { error: message }));
        setUpdateError(message);
        showToast(t("app.updateFailed"));
      }
    } finally {
      setUpdateChecking(false);
    }
  }

  async function refreshSessionHistory(projectId = sessionsProjectId) {
    if (!projectId) return;
    setSessionHistoryLoading(true);
    try {
      // 项目历史弹框内的刷新需要显式进入 loading 状态;否则刷新很快完成时用户会误以为按钮没有响应。
      await refreshProjectSessions(projectId, true);
    } finally {
      setSessionHistoryLoading(false);
    }
  }

  async function openProjectSessions(project: Project) {
    setProjectMenu(null);
    setActiveProjectId(project.id);
    setSessionsProjectId(project.id);
    setDrawer("sessions");
    setDrawerCollapsed(false);
    await refreshSessionHistory(project.id);
  }


  async function cloneAgentSession(agentId: string) {
    setAgentActionLoading("copy");
    try {
      const result = await api.agents.cloneSession(agentId);
      if (result?.cancelled) {
        showToast(t("app.sessionCopyCancelled"));
        return;
      }
      showToast(t("app.currentSessionCopied"));
      await refreshRuntimeState(agentId);
      const projectId = agents.find((agent) => agent.id === agentId)?.projectId ?? activeProjectId;
      if (projectId) await refreshProjectSessions(projectId);
      if (result.targetSessionId && projectId) {
        selectSessionCommand(projectId, result.targetSessionId, true);
      }
    } finally {
      setAgentActionLoading(null);
      setAgentMenu(null);
    }
  }

  function openAgentRename(agent: AgentTab) {
    setAgentMenu(null);
    setAgentRenameTarget(agent);
    setSessionRenameTarget(null);
    setAgentRenameValue(agent.title);
  }

  function openSessionRename(projectId: string, session: SessionSummary) {
    setAgentRenameTarget(null);
    setSessionRenameTarget({ projectId, session });
    setAgentRenameValue(session.name || t("common.untitled"));
  }

  async function submitAgentRename() {
    if (!agentRenameTarget) return;
    const name = agentRenameValue.replace(/\s+/g, " ").trim();
    if (!name) {
      showToast(t("app.sessionNameRequired"), 2200);
      return;
    }
    setAgentRenaming(true);
    try {
      const tab = await api.agents.rename(agentRenameTarget.id, name);
      upsertAgent(tab);
      setAgentRenameTarget(null);
      setSessionRenameTarget(null);
      setAgentRenameValue("");
      showToast(t("app.sessionRenamed"), 2200);
      await refreshProjectSessions(tab.projectId);
    } catch (error) {
      showToast(
        t("app.sessionRenameFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000,
      );
    } finally {
      setAgentRenaming(false);
    }
  }

  async function submitSessionRename() {
    if (!sessionRenameTarget) return;
    const name = agentRenameValue.replace(/\s+/g, " ").trim();
    if (!name) {
      showToast(t("app.sessionNameRequired"), 2200);
      return;
    }
    setAgentRenaming(true);
    try {
      await api.sessions.updateRecord(sessionRenameTarget.session.id, { title: name });
      await refreshProjectSessions(sessionRenameTarget.projectId);
      setSessionRenameTarget(null);
      setAgentRenameValue("");
      showToast(t("app.sessionRenamed"), 2200);
    } catch (error) {
      showToast(
        t("app.sessionRenameFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000,
      );
    } finally {
      setAgentRenaming(false);
    }
  }

  async function deleteDraftSession(session: SessionRecord) {
    await api.sessions.deleteRecord(session.id);
    removeSessionState(session.id);
    removeSessionComposerState(session.id);
  }


  async function reorderProjects(
    sourceProjectId: string,
    targetProjectId: string,
  ) {
    if (!canReorderProjects || sourceProjectId === targetProjectId) return;
    const sourceProject = projects.find(
      (project) => project.id === sourceProjectId,
    );
    const targetProject = projects.find(
      (project) => project.id === targetProjectId,
    );
    if (isChatProject(sourceProject) || isChatProject(targetProject)) return;
    const sourceIndex = projects.findIndex(
      (project) => project.id === sourceProjectId,
    );
    const targetIndex = projects.findIndex(
      (project) => project.id === targetProjectId,
    );
    if (sourceIndex === -1 || targetIndex === -1) return;

    const previousProjects = projects;
    const nextProjects = [...projects];
    const [movedProject] = nextProjects.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextProjects.findIndex(
      (project) => project.id === targetProjectId,
    );
    const insertIndex =
      sourceIndex < targetIndex
        ? targetIndexAfterRemoval + 1
        : targetIndexAfterRemoval;
    nextProjects.splice(insertIndex, 0, movedProject);
    setProjects(nextProjects);

    try {
      const savedProjects = await api.projects.reorder(
        nextProjects.map((project) => project.id),
      );
      setProjects(savedProjects);
    } catch (error) {
      setProjects(previousProjects);
      showToast(
        t("app.projectSortFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000,
      );
    }
  }

  async function addProject() {
    const project = await api.projects.add();
    if (!project) return;
    await refreshProjects();
    setActiveProjectId(project.id);
  }

  function updateAfterProjectRemoved(
    removedProjectId: string,
    next: Project[],
  ) {
    setVisibleProjectChildCountByProject((current) => {
      const updated = { ...current };
      delete updated[removedProjectId];
      return updated;
    });
    if (activeProjectId === removedProjectId) {
      setActiveProjectId(next[0]?.id);
    }
    if (sessionsProjectId === removedProjectId) {
      setSessionsProjectId(undefined);
      if (drawer === "sessions") setDrawer(null);
    }
  }


  function applyAgentRuntimeState(agentId: string, incoming: AgentRuntimeState) {
    const nextState = mergeAgentRuntimeState(
      runtimeStateByAgentRef.current[agentId],
      incoming,
    );
    runtimeStateByAgentRef.current = {
      ...runtimeStateByAgentRef.current,
      [agentId]: nextState,
    };
    applyRuntimeCapability({ agentId, state: incoming });
    return nextState;
  }

  async function refreshRuntimeState(agentId = activeAgentId) {
    if (!agentId || isPendingAgentId(agentId)) return;
    const state = await api.agents.runtimeState(agentId).catch(() => undefined);
    if (state) applyAgentRuntimeState(agentId, state);
  }

  /** 调整菜单位置避免溢出视口 */
  function adjustMenuPos(x: number, y: number, width = 200, height = 260) {
  	const vw = window.innerWidth;
  	const vh = window.innerHeight;
  	return {
  		x: x + width > vw ? Math.max(4, vw - width - 8) : x,
  		y: y + height > vh ? Math.max(4, vh - height - 8) : y,
  	};
  }

  // 无 agent 时模型列表缓存，避免每次打开模型选择器都 fork pi --list-models
  const cachedModelsRef = useRef<AvailableModel[] | null>(null);

  async function openModelPicker() {
    // Session 已绑定 runtime 时走 RPC；惰性历史 Session 则只读取项目模型列表。
    const runtimeAgentId = currentSessionLiveAgentId;
    if (runtimeAgentId && !isPendingAgentId(runtimeAgentId)) {
      const models = await api.agents.availableModels(runtimeAgentId);
      setAvailableModels(models);
      setModelPickerOpen(true);
      return;
    }
    // 无 agent → 优先用缓存，否则走 pi --list-models
    if (cachedModelsRef.current) {
      setAvailableModels(cachedModelsRef.current);
      setModelPickerOpen(true);
      return;
    }
    const models = await api.projects.listModels(activeProjectId);
    cachedModelsRef.current = models;
    setAvailableModels(models);
    setModelPickerOpen(true);
  }

  async function openPromptTemplatePicker() {
    // prompt 模板读取的是文件系统，不需要 agent RPC
    const allTemplates: typeof promptTemplateList = [];
    try {
      const globalResult = await api.prompts.list();
      for (const tpl of globalResult.templates) {
        allTemplates.push({
            ...tpl,
            description: translateBuiltinPromptDescription(tpl),
            argumentHint: parseArgumentHint(tpl.content),
        });
      }
    } catch {
      // 全局列表失败时继续加载项目列表
    }
    // 同时加载当前活动项目的项目级提示词
    const activeProject = activeProjectId
      ? projects.find((p) => p.id === activeProjectId)
      : undefined;
    if (activeProject) {
      try {
        const projectResult = await api.prompts.listByProject(activeProject.path);
        allTemplates.push(...projectResult.templates);
      } catch {
        // 项目无 .pi/prompts/ 目录时静默跳过
      }
    }
    setPromptTemplateList(allTemplates);
    setPromptTemplatePickerOpen(true);
  }

  function selectPromptTemplate(template: {
    name: string;
    path: string;
    description: string;
    content: string;
    argumentHint?: string;
  }) {
    // 插入斜线命令形式，pi 会在发送时自动展开，末尾加空格分割后续输入
    setPrompt((prev) => {
      const trimmed = prev ? prev.trimEnd() : "";
      if (!trimmed) return "/" + template.name + " ";
      return trimmed + " /" + template.name + " ";
    });
    setPromptTemplatePickerOpen(false);
  }

  async function selectModel(model: AvailableModel) {
    if (currentSessionId) {
      try {
        if (currentSessionLiveAgentId) {
          await api.agents.setModel(
            currentSessionLiveAgentId,
            model.provider,
            model.id,
          );
        }
        await api.sessions.updateRecord(currentSessionId, {
          model: { provider: model.provider, modelId: model.id },
        });
        if (currentSession) {
          upsertSession({
            ...currentSession,
            model: { provider: model.provider, modelId: model.id },
            updatedAt: Date.now(),
          });
        }
        setModelPickerOpen(false);
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 4000);
      }
      return;
    }
    setModelPickerOpen(false);
  }

  /** 切换模型的收藏状态，收藏的模型在选模型列表中置顶显示 */
  function toggleFavoriteModel(provider: string, modelId: string) {
    const key = `${provider}/${modelId}`;
    const current = settings.favoriteModels ?? [];
    const isNowFavorite = !current.includes(key);
    const next = isNowFavorite
      ? [...current, key]
      : current.filter((id) => id !== key);
    void updateSettings({ favoriteModels: next });
    showToast(
      isNowFavorite ? t("app.modelFavorited", { name: modelId }) : t("app.modelUnfavorited", { name: modelId }),
      1500,
    );
  }

  async function selectThinking(level: string) {
    if (currentSessionId) {
      try {
        if (currentSessionLiveAgentId) {
          await api.agents.setThinking(currentSessionLiveAgentId, level);
        }
        await api.sessions.updateRecord(currentSessionId, {
          thinkingLevel: level,
        });
        if (currentSession) {
          upsertSession({
            ...currentSession,
            thinkingLevel: level,
            updatedAt: Date.now(),
          });
        }
        setThinkingPickerOpen(false);
      } catch (error) {
        showToast(
          t("app.thinkingSwitchFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }
    setThinkingPickerOpen(false);
  }

  async function compactAgent(compactPrompt?: string, agentId = activeAgentId) {
    if (!agentId || isPendingAgentId(agentId)) return;
    setCompacting(true);
    try {
      const state = await api.agents.compact(agentId, compactPrompt);
      applyAgentRuntimeState(agentId, state);
      showToast(t("app.compactDone"));
    } catch (e) {
      showToast(t("app.compactFailed"));
    } finally {
      setCompacting(false);
    }
  }

  async function closeAgent(agentId: string) {
    if (isPendingAgentId(agentId)) return;
    await api.agents.stop(agentId);
  }

  async function abortAgent(agentId = activeAgentId) {
    if (!agentId || isPendingAgentId(agentId)) return;
    // 立即清除流式状态，让思考气泡和 loading 立刻消失，不等后端 RPC 返回
    const previous = runtimeStateByAgentRef.current[agentId];
    if (previous) {
      applyAgentRuntimeState(agentId, { ...previous, isStreaming: false });
    }
    await api.agents.abort(agentId);
    // 不调用 refreshRuntimeState：AgentManager.abort() 会通过 emitState 推送正确状态，
    // 避免后端 get_state 返回过时的 isStreaming: true 覆盖前端立刻设的 false。
  }

  async function restartActiveAgent() {
    if (!activeAgentId || !activeAgent) return;
    const restartingAgent = activeAgent;
    setRestartingAgentId(restartingAgent.id);
    setSessionActionsOpen(false);
    pendingAgentsRef.current = [
      ...pendingAgentsRef.current.filter(
        (agent) => agent.id !== restartingAgent.id,
      ),
      {
        ...restartingAgent,
        status: "starting",
        pendingKind: "restart",
        pendingStartedAt: Date.now(),
      },
    ];
    setPendingAgents(pendingAgentsRef.current);
    try {
      const tab = await api.agents.restart(restartingAgent.id);
      pendingAgentsRef.current = pendingAgentsRef.current.filter(
        (agent) => agent.id !== restartingAgent.id,
      );
      setPendingAgents(pendingAgentsRef.current);
      void refreshRuntimeState(tab.id);
      showToast(t("app.agentRestarted"), 2000);
    } catch (error) {
      pendingAgentsRef.current = pendingAgentsRef.current.map((agent) =>
        agent.id === restartingAgent.id
          ? { ...agent, status: "error" }
          : agent,
      );
      setPendingAgents(pendingAgentsRef.current);
      showToast(error instanceof Error ? error.message : String(error), 5000);
    } finally {
      setRestartingAgentId((current) =>
        current === restartingAgent.id ? null : current,
      );
    }
  }



  async function exportAgentHtml(agentId: string) {
    if (isPendingAgentId(agentId)) return;
    setAgentActionLoading("export");
    try {
      const result = await api.agents.exportHtml(agentId);
      showToast(t("app.exportedPath", { path: result.path }), 3500);
    } finally {
      setAgentActionLoading(null);
      setAgentMenu(null);
    }
  }

  function setTerminalOpenForAgent(agentId: string, open: boolean) {
    setTerminalDockStateByAgent((current) =>
      setTerminalDockOpen(current, agentId, open),
    );
  }

  function setTerminalCollapsedForAgent(agentId: string, collapsed: boolean) {
    setTerminalDockStateByAgent((current) =>
      setTerminalDockCollapsed(current, agentId, collapsed),
    );
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (suggestionsOpen && suggestionItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) =>
          Math.min(index + 1, suggestionItems.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        // IME 确认时也会触发 Enter(keyCode=229 或 isComposing),不放行到建议选中。
        if ((event.nativeEvent as KeyboardEvent).isComposing || event.keyCode === 229) return;
        event.preventDefault();
        const selected =
          suggestionItems[
            Math.min(selectedSuggestionIndex, suggestionItems.length - 1)
          ];
        if (selected) {
          // 以光标为锚替换触发符..光标这一段,并在下一帧恢复光标到插入项之后。
          const el = event.currentTarget;
          const cursor = getCaretOffsetOf(el);
          const liveComposerPrompt = getLiveComposerPrompt();
          const result = applySuggestion(liveComposerPrompt, cursor, selected.value);
          // RichInput 的受控同步会基于 value 重渲染并恢复光标,这里同步状态即可。
          setPrompt(result.text);
          setComposerCursor(result.cursor);
          pendingComposerCaretRef.current = result.cursor;
          setSuggestionsOpen(false);
          requestAnimationFrame(() => {
            composerTextareaRef.current?.focus();
          });
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const el = event.currentTarget;
        const cursor = getCaretOffsetOf(el);
        const liveComposerPrompt = getLiveComposerPrompt();
        const result = clearSuggestionTrigger(liveComposerPrompt, cursor);
        setPrompt(result.text);
        setComposerCursor(result.cursor);
        pendingComposerCaretRef.current = result.cursor;
        setSuggestionsOpen(false);
        requestAnimationFrame(() => {
          composerTextareaRef.current?.focus();
        });
        return;
      }
    }

    // 历史命令导航:只在光标位于第一行时生效
    const editor = event.currentTarget;
    const cursorPos = getCaretOffsetOf(editor);
    const textBeforeCursor = prompt.substring(0, cursorPos);
    const isFirstLine = !textBeforeCursor.includes('\n');
    const textAfterCursor = prompt.substring(cursorPos);
    const isLastLine = !textAfterCursor.includes('\n');

    // 当前 Agent 的历史记录
    const agentHistory = promptHistoryRef.current[getComposerTargetId() ?? ""] ?? [];

    if (event.key === "ArrowUp" && isFirstLine && agentHistory.length > 0) {
      event.preventDefault();

      // 首次导航时保存当前输入
      if (!historyNavigating) {
        setSavedPrompt(prompt);
        setHistoryNavigating(true);
        const newIndex = 0;
        setHistoryIndex(newIndex);
        setPrompt(agentHistory[newIndex]);
      } else {
        // 继续向上导航
        const newIndex = Math.min(historyIndex + 1, agentHistory.length - 1);
        if (newIndex !== historyIndex) {
          setHistoryIndex(newIndex);
          setPrompt(agentHistory[newIndex]);
        }
      }
      return;
    }

    if (event.key === "ArrowDown" && isLastLine && historyNavigating) {
      event.preventDefault();

      if (historyIndex > 0) {
        // 向下导航
        const newIndex = historyIndex - 1;
        // 防御：如果新索引越界（Agent 切换后历史更短），安全退出导航模式
        if (newIndex >= agentHistory.length) {
          setHistoryIndex(-1);
          setHistoryNavigating(false);
          setSavedPrompt("");
          return;
        }
        setHistoryIndex(newIndex);
        setPrompt(agentHistory[newIndex]);
      } else {
        // 回到最初输入的内容
        setHistoryIndex(-1);
        setHistoryNavigating(false);
        setPrompt(savedPrompt);
        setSavedPrompt("");
      }
      return;
    }

    if (event.key === "Escape") {
      const el = event.currentTarget;
      const cursor = getCaretOffsetOf(el);
      const liveComposerPrompt = getLiveComposerPrompt();
      const result = clearSuggestionTrigger(liveComposerPrompt, cursor);
      setPrompt(result.text);
      setComposerCursor(result.cursor);
      setSuggestionsOpen(false);
      // 如果正在历史导航,ESC 退出并恢复原始输入
      if (historyNavigating) {
        setPrompt(savedPrompt);
        setHistoryIndex(-1);
        setHistoryNavigating(false);
        setSavedPrompt("");
      }
    }
    const enterIntent = getComposerEnterIntent(event, settings.sendShortcut);
    if (enterIntent === "send") {
      event.preventDefault();
      void sendPrompt();
    } else if (enterIntent === "newline") {
      // RichInput 内部会在 Enter 未被上层 preventDefault 时手动插入 \n。
      return;
    }
  }

  const isAgentStarting =
    activeConversationStatus === "starting" ||
    currentSessionSendState.status === "activating";
  const composerDisabled =
    !hasActiveConversation || (!currentSessionId && isAgentStarting);
  const isAgentBusy = Boolean(
    hasActiveConversation &&
    (activeConversationStatus === "running" || activeRuntimeState?.isStreaming),
  );
  // hasComposerContent 合并文本状态（hasComposerText，仅在空↔非空翻转时触发重渲染）
  // 与图片附件；images 本身已是 state 变化即触发重渲染。
  const hasComposerContent = hasComposerText || attachedImages.length > 0;
  const keepBusyDraftControls = Boolean(
    activeAgentId && hasComposerContent && busyDraftByAgent[activeAgentId],
  );
  const showBusySendControls = isAgentBusy || keepBusyDraftControls;

  // 图片附件等非文本输入同样应锁定忙碌草稿控件；内容清空后再释放锁定。
  useEffect(() => {
    if (!activeAgentId) return;
    setBusyDraftByAgent((current) => {
      if (!hasComposerContent) {
        if (!current[activeAgentId]) return current;
        const next = { ...current };
        delete next[activeAgentId];
        return next;
      }
      if (!isAgentBusy || current[activeAgentId]) return current;
      return { ...current, [activeAgentId]: true };
    });
  }, [activeAgentId, hasComposerContent, isAgentBusy]);

  // 已删除内置 goal 自动续接。
  useEffect(() => {
    prevIsAgentBusyRef.current = isAgentBusy;
  }, [isAgentBusy]);

  /** 解析消息中的 & 会话引用，将 chip 替换为引用上下文 */
  async function resolveSessionRefs(message: string): Promise<string> {
    let resolved = message;
    const sorted = [...activeProjectSessions].sort(
      (a, b) => (b.name ?? b.filePath).length - (a.name ?? a.filePath).length,
    );
    for (const session of sorted) {
      const sessionName = session.name ?? session.filePath;
      const raw = `&${sessionName}`;
      // 大小写不敏感查找，但保留原始大小写用于替换
      const lowerResolved = resolved.toLowerCase();
      const lowerRaw = raw.toLowerCase();
      if (!lowerResolved.includes(lowerRaw)) continue;
      // 预编译正则 pattern，避免在 if/else 分支中重复创建
      const pattern = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      let msgs: Array<{ role: string; content: string }> | undefined;
      if (sessionRefSelections[raw]) {
        msgs = sessionRefSelections[raw].messages;
      } else {
        try {
          const all = await api.sessions.readMessages(session.filePath);
          const loaded = all.map((m) => ({ role: m.role, content: m.content }));
          msgs = loaded;
          setSessionRefSelections((prev) => ({ ...prev, [raw]: { messages: loaded, fullContext: true, selectedIndices: loaded.map((_, i) => i) } }));
        } catch {
          // 加载失败时 chip 会在下面 else 分支被移除
        }
      }

      if (msgs && msgs.length > 0) {
        const ctx = msgs.map((m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`).join("\n");
        const refBlock = `<referenced_session name="${sessionName}">\n${ctx}\n</referenced_session>`;
        resolved = resolved.replace(pattern, refBlock);
      } else {
        resolved = resolved.replace(pattern, "");
      }
    }
    return resolved;
  }

  // 处理所有 agent 的 idle 队列：隐藏会话也不会因切换选中项而卡住。
  // tool-end 的 steer 投递直接在 onRuntimeState 原始事件上处理，避免批量 render 漏边沿。
  useEffect(() => {
    for (const agentId of Object.keys(queue.queuedPrompts)) {
      if (queue.canFlushQueuedPrompt(agentId)) {
        void queue.flushNextQueuedPrompt(agentId);
      }
    }
  }, [activeProjectRuntimeCapabilities, agents, queue.queuedPrompts]);

  useEffect(() => {
    return () => {
      if (sendBehaviorMenuCloseTimerRef.current) {
        clearTimeout(sendBehaviorMenuCloseTimerRef.current);
        sendBehaviorMenuCloseTimerRef.current = null;
      }
    };
  }, []);

  function keepSendBehaviorMenuOpen() {
    if (sendBehaviorMenuCloseTimerRef.current) {
      clearTimeout(sendBehaviorMenuCloseTimerRef.current);
      sendBehaviorMenuCloseTimerRef.current = null;
    }
    setSendBehaviorMenuOpen(true);
  }

  function scheduleSendBehaviorMenuClose() {
    if (sendBehaviorMenuCloseTimerRef.current) {
      clearTimeout(sendBehaviorMenuCloseTimerRef.current);
    }
    sendBehaviorMenuCloseTimerRef.current = setTimeout(() => {
      setSendBehaviorMenuOpen(false);
      sendBehaviorMenuCloseTimerRef.current = null;
    }, 160);
  }

  const sendCurrentSessionPrompt = useSessionSend({
    sendPrompt: (input) => api.sessions.sendPrompt(input),
    liveDraftsRef: livePromptByAgentRef,
    getComposerText: () => composerTextareaRef.current?.textContent ?? "",
    templates: promptTemplateList,
    runtimeAgentId: currentSessionLiveAgentId,
    compact: (agentId, compactPrompt) => compactAgent(compactPrompt, agentId),
    resetComposerUi: () => {
      setHistoryIndex(-1);
      setHistoryNavigating(false);
      setSavedPrompt("");
      setSuggestionsOpen(false);
      setSendBehaviorMenuOpen(false);
      setComposerAutoHeight(COMPOSER_MIN_HEIGHT);
      setAutoScroll(true);
      autoScrollRef.current = true;
    },
    recordPromptHistory: (sessionId, message) => {
      if (!message.trim() || message.startsWith("!")) return;
      const previous = promptHistoryRef.current[sessionId] ?? [];
      promptHistoryRef.current[sessionId] = [
        message.trim(),
        ...previous.filter((command) => command !== message.trim()),
      ].slice(0, 50);
    },
    refreshProject: (projectId) => {
      void refreshProjectSessions(projectId, true).catch(() => undefined);
    },
    showError: showToast,
    showUnknown: () => showToast(t("app.queuedUnknown"), 6000),
    showCompactUnavailable: () => {
      showToast("会话尚未启动，请先发送一条消息再压缩", 3000);
    },
  });

  async function sendPrompt(override?: {
    agentId: string;
    message: string;
    images: ImageContent[];
    agentMode: ComposerAgentMode;
  }) {
    if (!override && currentSessionId) {
      return sendCurrentSessionPrompt(isAgentBusy ? "steer" : undefined);
    }
    const targetAgentId = override?.agentId ?? activeAgentId;
    // 发送前从 DOM 直读文本，避免 contentEditable 的 IME 组合期间 handleInput 被锁导致 ref 落后于 DOM
    if (!override && targetAgentId) {
      const domText = (composerTextareaRef.current?.textContent ?? "").replace(/\u200B/g, "");
      if (domText) livePromptByAgentRef.current[targetAgentId] = domText;
    }
    const livePrompt = override?.message ?? (targetAgentId
      ? (livePromptByAgentRef.current[targetAgentId] ?? prompt)
      : prompt);
    const attachedImagesSnapshot = override?.images ?? attachedImages;
    const agentMode = override?.agentMode ?? currentComposerAgentMode;
    if (
      (!override && isAgentStarting) ||
      !targetAgentId ||
      (!livePrompt.trim() && attachedImagesSnapshot.length === 0)
    )
      return;
    const message = livePrompt;
    if (!override) delete livePromptByAgentRef.current[targetAgentId];
    const images = attachedImagesSnapshot.length > 0 ? attachedImagesSnapshot : undefined;

    const trimmedMessage = message.trim();

    // 已删除内置 /goal 拦截，命令直接发给 agent。

    // ── /compact 命令处理 ──
    if (/^\/compact(?:\s|$)/.test(trimmedMessage)) {
      const compactPrompt = trimmedMessage.replace(/^\/compact\s*/, "").trim();
      // /compact 是桌面端内置控制命令，必须走 RPC compact 通道；否则会被当作普通消息发送给 agent。
      setPromptForAgent(targetAgentId, "");
      setAttachedImagesForAgent(targetAgentId, []);
      setSuggestionsOpen(false);
      await compactAgent(compactPrompt || undefined, targetAgentId);
      return;
    }

    // 保存到当前 Agent 的历史记录（不持久化，Agent 关闭即清除）
    if (message.trim() && !message.startsWith("!")) {
      const agentId = targetAgentId;
      const prev = promptHistoryRef.current[agentId] ?? [];
      const filtered = prev.filter(cmd => cmd !== message.trim());
      promptHistoryRef.current[agentId] = [message.trim(), ...filtered].slice(0, 50);
    }

    // 重置历史导航状态
    setHistoryIndex(-1);
    setHistoryNavigating(false);
    setSavedPrompt("");

    // 发送前先保留快照,再立即清空 composer;运行中发送会走官方 steer 队列,
    // 由 pi runtime 保证在当前工具调用结束后、下一次 LLM 调用前注入。
    // 不论之前是否滚动回看，发新消息都强制自动滚到底，确保能看到 agent 的回答。
    setAutoScroll(true);
    autoScrollRef.current = true;
    // 本次发送使用独立快照，不消费 runtime 激活期间新写入同一 Session 的下一条草稿。
    if (!override) {
      setPromptForAgent(targetAgentId, "");
      setAttachedImagesForAgent(targetAgentId, []);
    }
    setBusyDraftByAgent((current) => {
      if (!current[targetAgentId]) return current;
      const next = { ...current };
      delete next[targetAgentId];
      return next;
    });
    setSuggestionsOpen(false);
    setSendBehaviorMenuOpen(false);
    // 发送后强制重置自动高度：避免粘贴多行内容后 scrollHeight 残留导致 composer 无法恢复默认高度。
    // 下一帧 DOM 同步后再跑一次 syncComposerAutoHeight，让最终高度以清空后的 scrollHeight 为准。
    // 发送后固定 composer 高度，不再自动适配内容高度
    // 让输入框保持固定大小，超出部分滚动显示
    setComposerAutoHeight(COMPOSER_MIN_HEIGHT);

    // 在发送前本地展开 prompt template 命令（/name → 完整内容），
    // 避免依赖 pi 的展开导致用户附加文本丢失以及特殊符号干扰
    // 同时提取模板的 description 作为元数据发给 pi agent，让其了解本次 prompt 意图
    const { message: expandedMessage, description: templateDescription } = expandPromptTemplates(message, promptTemplateList);

    const queuedPromptSnapshot: QueuedPrompt = {
      id: crypto.randomUUID(),
      message: expandedMessage,
      displayText: message,
      images,
      behavior: "steer",
      agentMode,
      templateDescription,
      timestamp: Date.now(),

    };
    if (isAgentBusy) {
      if (!queue.enqueueQueuedPrompt(targetAgentId, queuedPromptSnapshot)) {
        setPromptForAgent(targetAgentId, (current) =>
          [message, current].filter((text) => text.trim()).join("\n\n"),
        );
        if (images) {
          setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
        }
        showToast(t("app.queuedFull", { count: QUEUED_PROMPT_LIMIT }), 3000);
      }
      return;
    }

    const accepted = await submitPromptSnapshot(
      targetAgentId,
      expandedMessage,
      images,
      undefined,
      agentMode,
      templateDescription,
    );
    if (accepted === "unknown") {
      queue.appendUnknownQueuedPrompt(targetAgentId, {
        ...queuedPromptSnapshot,
        behavior: "direct",
      });
      return;
    }
    if (!accepted) {
      // 首条失败时恢复到第二条草稿之前；不要预写 live ref，否则会重复拼接。
      setPromptForAgent(targetAgentId, (current) =>
        [message, current].filter((text) => text.trim()).join("\n\n"),
      );
      if (images) {
        setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
      }
      return;
    }
    // 此时用户消息已经渲染到 DOM（状态在 await 前已提交），直接滚到底部确保用户看不到消息开头。
    // 后续流式渲染靠 ResizeObserver（已有 useEffect）自动追踪容器高度变化持续滚动。
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (el && autoScrollRef.current) {
        programmaticScrollRef.current = true;
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      }
    });
  }

  async function sendPromptAsFollowUp() {
    if (currentSessionId) {
      await sendCurrentSessionPrompt("followUp");
      return;
    }
    const targetAgentId = activeAgentId;
    const livePrompt = targetAgentId
      ? (livePromptByAgentRef.current[targetAgentId] ?? prompt)
      : prompt;
    if (
      isAgentStarting ||
      !targetAgentId ||
      (!livePrompt.trim() && attachedImages.length === 0)
    )
      return;
    const message = livePrompt;
    // 在任何 await 之前清掉实时草稿，防止双击/Enter 连发读取同一份消息。
    delete livePromptByAgentRef.current[targetAgentId];
    const images = attachedImages.length > 0 ? attachedImages : undefined;
    setAutoScroll(true);
    autoScrollRef.current = true;
    programmaticScrollRef.current = true;
    const scrollTimeline = timelineRef.current;
    if (scrollTimeline) scrollTimeline.scrollTo({ top: scrollTimeline.scrollHeight, behavior: "instant" });
    setPrompt("");
    setAttachedImages([]);
    // 保存到当前 Agent 的历史记录（与 sendPrompt 保持一致）
    if (message.trim() && !message.startsWith("!")) {
      const prev = promptHistoryRef.current[targetAgentId] ?? [];
      const filtered = prev.filter(cmd => cmd !== message.trim());
      promptHistoryRef.current[targetAgentId] = [message.trim(), ...filtered].slice(0, 50);
    }
    // 重置历史导航状态
    setHistoryIndex(-1);
    setHistoryNavigating(false);
    setSavedPrompt("");
    setBusyDraftByAgent((current) => {
      if (!current[targetAgentId]) return current;
      const next = { ...current };
      delete next[targetAgentId];
      return next;
    });
    setSuggestionsOpen(false);
    setSendBehaviorMenuOpen(false);
    setComposerAutoHeight(COMPOSER_MIN_HEIGHT);

    const queuedPromptSnapshot: QueuedPrompt = {
      id: crypto.randomUUID(),
      message,
      displayText: message,
      images,
      behavior: "followUp",
      agentMode: currentComposerAgentMode,
      timestamp: Date.now(),
    };
    if (isAgentBusy) {
      if (!queue.enqueueQueuedPrompt(targetAgentId, queuedPromptSnapshot)) {
        setPromptForAgent(targetAgentId, (current) =>
          [message, current].filter((text) => text.trim()).join("\n\n"),
        );
        if (images) {
          setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
        }
        showToast(t("app.queuedFull", { count: QUEUED_PROMPT_LIMIT }), 3000);
      }
      return;
    }

    const accepted = await submitPromptSnapshot(
      targetAgentId,
      message,
      images,
      "followUp",
      currentComposerAgentMode,
    );
    if (accepted === "unknown") {
      queue.appendUnknownQueuedPrompt(targetAgentId, queuedPromptSnapshot);
      return;
    }
    if (!accepted) {
      livePromptByAgentRef.current[targetAgentId] = message;
      setPromptForAgent(targetAgentId, (current) =>
        [message, current].filter((text) => text.trim()).join("\n\n"),
      );
      if (images) {
        setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
      }
      return;
    }
    // 用 MutationObserver 监听消息列表 DOM 变化

    const scrollOnNewMessage = () => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const list = timeline.querySelector(".message-list");
      if (!list) return;
      const observer = new MutationObserver(() => {
        if (!autoScrollRef.current) return;
        programmaticScrollRef.current = true;
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
      });
      observer.observe(list, { childList: true, subtree: false });
      setTimeout(() => observer.disconnect(), 8000);
    };
    requestAnimationFrame(scrollOnNewMessage);
  }

  // 已删除内置 /goal 与 startNewGoal 实现。

  async function dispatchPromptSnapshot(
    agentId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
    agentMode: ComposerAgentMode = "normal",
    templateDescription?: string,
  ) {
    const submission = buildComposerPromptSubmission(message, agentMode);
    let result: Awaited<ReturnType<typeof api.agents.prompt>>;
    try {
      result = await api.agents.prompt({
        agentId,
        message: submission.message,
        images,
        ...(submission.agentMessage ? { agentMessage: submission.agentMessage } : {}),
        ...(templateDescription ? { description: templateDescription } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
    } catch (error) {
      // IPC/fetch 在请求发出后断开时无法判断主进程是否已经提交给 pi；按未知处理，
      // 绝不能把它降级为可重试失败，否则网络/IPC 抖动会造成重复发送。
      throw new PromptDeliveryUnknownError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!result.accepted) {
      if (result.delivery === "unknown") {
        throw new PromptDeliveryUnknownError(result.error);
      }
      throw new Error(result.error);
    }
  }

  async function submitPromptSnapshot(
    agentId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
    agentMode: ComposerAgentMode = "normal",
    /** prompt 模板匹配到的 description，作为元数据发给 pi agent 标识意图 */
    templateDescription?: string,
  ) {
    // 非队列入口继续保持原有行为：当前选中 agent 忙碌时默认 steer。
    // 客户端队列 drain 直接调用 dispatchPromptSnapshot，并显式指定其投递语义。
    const behavior =
      streamingBehavior ??
      (agentId === activeAgentId && isAgentBusy ? "steer" : undefined);
    try {
      await dispatchPromptSnapshot(
        agentId,
        message,
        images,
        behavior,
        agentMode,
        templateDescription,
      );
      return true;
    } catch (error) {
      if (error instanceof PromptDeliveryUnknownError) {
        showToast(t("app.queuedUnknown"), 6000);
        return "unknown" as const;
      }
      showToast(error instanceof Error ? error.message : String(error), 4000);
      return false;
    }
  }

  /** 重发防重复：通过 messageId 锁避免同一消息多次重发。
   *  锁会在 agent 状态切回 idle 时自动清除（下方 useEffect），超时 30s 兜底释放。 */
  const resendingIdsRef = useRef<Set<string>>(new Set());

  function resendUserMessage(message: ChatMessage) {
    if (!activeAgentId || message.agentId !== activeAgentId) return;
    if (resendingIdsRef.current.has(message.id)) return;
    resendingIdsRef.current.add(message.id);
    // 30 秒兜底释放，防止锁泄漏
    setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);

    // "重新发送"按原消息快照再次提交,不修改输入框,图片也复用原始 base64 内容。
    void submitPromptSnapshot(activeAgentId, message.text, message.images);
  }

  /** agent 切回 idle 时释放所有重发锁，允许下次正常重发。 */
  useEffect(() => {
    if (activeAgent?.status !== "running" && activeAgent?.status !== "starting") {
      resendingIdsRef.current.clear();
    }
  }, [activeAgent?.status]);

  /** 将主进程抛出的错误消息中的 BUSY_ 前缀码转为前端多语言文案 */
  function translateAgentErrorMessage(msg: string): string {
    if (msg.startsWith("BUSY_STREAMING:")) return t("message.busyStreaming");
    if (msg.startsWith("BUSY_TOOL:")) return t("message.busyTool");
    if (msg.startsWith("BUSY_GENERIC:")) return t("message.busyGeneric");
    return msg;
  }

  /**
   * 编辑消息：修改 JSONL + 重载会话。用户已点击「编辑 + 保存」两步操作，意图明确，不额外弹框确认。
   */
  async function editMessage(messageId: string, newText: string) {
    if (!activeAgentId) return;
    try {
      await api.agents.editMessage(activeAgentId, messageId, newText);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showToast(`${t("message.editFailed")}: ${translateAgentErrorMessage(msg)}`, 5000);
    }
  }

  /**
   * 删除消息：从 JSONL 移除 + 重载会话。使用统一的自定义 ConfirmDialog。
   */
  function deleteMessage(messageId: string) {
    if (!activeAgentId) return;
    setConfirmDialog({
      title: t("message.deleteTitle"),
      message: t("message.deleteReloadPrompt"),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await api.agents.deleteMessage(activeAgentId!, messageId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          showToast(`${t("message.deleteFailed")}: ${translateAgentErrorMessage(msg)}`, 5000);
        }
      },
    });
  }

  /**
   * 处理图片文件,转为 pi RPC 可识别的 ImageContent。
   * 大图会压缩到最长边 2000px,避免 base64 过大导致 RPC 传输和模型上下文成本上升。
   */
  // === image paste hook ===
  const {
    processImageFile,
    fileToImageContent,
    dataUrlToImageContent,
    resizeImageFile,
  } = useImagePaste({
    showToast,
    t,
  });

  async function updateSettings(patch: Partial<AppSettings>) {
    const changesWebService =
      "webServiceEnabled" in patch ||
      "webServiceHost" in patch ||
      "webServicePort" in patch;
    if (changesWebService) {
      setWebServiceChanging(true);
      showToast(
        patch.webServiceEnabled === false
          ? t("app.webStopping")
          : t("app.webApplying"),
      );
    }
    try {
      const next = await api.settings.update(patch);
      setSettings(next);
      let notice = t("app.settingsSaved");
      if (
        "piProxyEnabled" in patch ||
        "piProxyUrl" in patch ||
        "piProxyBypass" in patch
      ) {
        notice = next.piProxyEnabled
          ? t("app.shellProxySaved")
          : t("app.shellProxyDisabled");
        piUpdate.setPiProxyNoticeTone("info");
        piUpdate.setPiProxyNotice(next.piProxyEnabled ? t("app.shellProxySaved") : "");
      }
      if (
        "desktopProxyEnabled" in patch ||
        "desktopProxyUrl" in patch ||
        "desktopProxyBypass" in patch
      ) {
        notice = next.desktopProxyEnabled
          ? t("app.webProxySaved")
          : t("app.webProxyDisabled");
      }
      if ("sendShortcut" in patch) {
        notice = t("app.sendShortcutSaved");
      }
      if (
        "webServiceEnabled" in patch ||
        "webServiceHost" in patch ||
        "webServicePort" in patch
      ) {
        notice = next.webServiceEnabled
          ? t("app.webServiceStarted", { port: next.webServicePort })
          : t("app.webServiceStopped");
      }
      if ("useNativeTitleBar" in patch) {
        notice = t("app.titleBarSaved");
      }
      // WSL/Windows pi 源切换：重新检测 pi 环境、刷新项目和会话列表
      if ("wslEnabled" in patch || "wslDistro" in patch || "wslUser" in patch) {
        void api.pi.check().then((next) => setPiStatus(next)).catch(() => undefined);
        void api.agents.list().then(setAgents).catch(() => undefined);
        void api.projects.list().then(setProjects).catch(() => undefined);
        if (activeProjectId) {
          void refreshProjectSessions(activeProjectId, true).catch(() => undefined);
        }
      }
      showToast(notice);
    } catch (error) {
      setSettings(await api.settings.get());
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      if (changesWebService) setWebServiceChanging(false);
    }
  }

  async function switchBranch(branch: string) {
    if (!activeProjectId || !branch || branch === gitInfo.current) return;
    setSwitchingBranch(branch);
    try {
      const next = await api.git.checkout(activeProjectId, branch);
      setGitInfo(next);
    } catch (error) {
      showToast(
        t("app.branchSwitchFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      // 失败后主动刷新一次,覆盖 git 拒绝切换或外部同时切换导致的 UI 状态偏差。
      const refreshed = await api.git
        .branches(activeProjectId)
        .catch(() => ({ current: null, branches: [] }));
      setGitInfo(refreshed);
    } finally {
      setSwitchingBranch(null);
    }
  }

  async function createBranch(branchName: string) {
    if (!activeProjectId || !branchName.trim()) return;
    setSwitchingBranch(branchName);
    try {
      const next = await api.git.createBranch(activeProjectId, branchName);
      setGitInfo(next);
      showToast(t("app.branchCreated", { branch: branchName }), 2500);
    } catch (error) {
      showToast(
        t("app.branchCreateFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSwitchingBranch(null);
    }
  }

  /** 创建新的 git worktree 工作区 */
  async function createWorktree(projectId: string, branchName: string) {
    setWorktreeCreating(true);
    try {
      const result = await api.git.worktreeCreate(projectId, branchName);
      // 刷新项目列表（新 worktree 已注册为项目）
      const next = await api.projects.list();
      setProjects(next);
      // 刷新 worktree 列表
      await refreshWorktrees(projectId);
      showToast(t("app.worktreeCreated") + result.branch);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("app.worktreeCreateFailed") + message, 5000);
      throw e;
    } finally {
      setWorktreeCreating(false);
    }
  }

  /** 删除 worktree 工作区 */
  async function removeWorktree(parentProjectId: string, worktreePath: string) {
    try {
      const removed = await api.git.worktreeRemove(parentProjectId, worktreePath);
      if (!removed) {
        throw new Error(t("app.worktreeRemoveNotFound"));
      }
      const next = await api.projects.list();
      setProjects(next);
      await refreshWorktrees(parentProjectId);
      showToast(t("app.worktreeRemoved"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("app.worktreeRemoveFailed") + message, 5000);
    } finally {
      // 无论成功还是失败，都移除动画状态，避免 worktree 行永久隐藏
      setRemovingWorktreePaths((prev) => {
        const next = new Set(prev);
        next.delete(worktreePath);
        return next;
      });
    }
  }

  /**
   * 请求删除 worktree：先校验是否有运行中的 Agent，再弹确认框，确认后执行删除。
   * 避免误删正在使用的 worktree，也保证删除结果通过 toast 反馈给用户。
   */
  function requestRemoveWorktree(
    parentProjectId: string,
    worktreePath: string,
    childProject: Project | undefined,
  ) {
    const childAgents = childProject
      ? displayAgents.filter(
          (a) =>
            a.projectId === childProject.id &&
            (a.status === "running" || a.status === "starting"),
        )
      : [];
    if (childAgents.length > 0) {
      showToast(t("app.worktreeRemoveBlockedByAgents"), 5000);
      return;
    }
    setConfirmDialog({
      title: t("app.worktreeRemoveConfirmTitle"),
      message: t("app.worktreeRemoveConfirmMessage"),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: () => {
        setConfirmDialog(null);
        // 先触发淡出动画（添加 removing 类），等动画结束后再执行真实删除。
        setRemovingWorktreePaths((prev) => new Set(prev).add(worktreePath));
        setTimeout(() => {
          void removeWorktree(parentProjectId, worktreePath);
        }, 280);
      },
    });
  }

  function openDrawer(panel: DrawerPanel) {
    if (panel === "git" && !settings.enableGitManagement) return;
    if (drawerPinned && panel !== drawerPinnedPanel) return;
    if (panel !== "git") closeGitDiff();
    if (panel === "sessions" && activeProjectId) {
      setSessionsProjectId(activeProjectId);
      void refreshProjectSessions(activeProjectId, true);
    }
    // 打开文件面板时触发一次静默刷新，确保目录结构是最新的，避免上次打开时文件已有变更但未刷新。
    if (panel === "files" && activeProjectId) {
      void refreshFiles(activeProjectId, true);
    }
    setDrawer((current) => {
      if (current === panel) return drawerPinned ? current : null;
      // 持久化当前项目的抽屉面板状态
      if (activeProjectId) saveDrawerState(activeProjectId, panel, drawerPinned);
      return panel;
    });
  }

  function closeDrawer() {
    if (drawerPinned) return;
    if (activeProjectId) saveDrawerState(activeProjectId, null, false);
    closeGitDiff();
    setDrawer(null);
  }

  function collapseDrawer() {
    if (drawerPinned) return;
    setDrawerCollapsed(true);
  }

  function toggleDrawerPinned() {
    if (!activeProjectId || !drawer) return;
    const willPin = !drawerPinned;
    setDrawerPinnedByProject((current) => {
      const next = { ...current };
      if (next[activeProjectId]) delete next[activeProjectId];
      else next[activeProjectId] = drawer;
      return next;
    });
    // 持久化钉选状态
    saveDrawerState(activeProjectId, drawer, willPin);
  }

  function toggleDirectory(path: string) {
    // 文件树默认折叠,只有用户显式展开目录才显示子项,避免大仓库一打开就产生视觉噪音。
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      // 持久化展开状态到 localStorage，切换回此项目时恢复
      if (activeProjectId) saveExpandedDirs(activeProjectId, next);
      return next;
    });
  }

  function collapseAllDirectories() {
    const collapsedDirs = new Set<string>();
    setExpandedDirs(collapsedDirs);
    // 全部收起同样持久化，避免用户切换项目后又恢复此前展开的目录。
    if (activeProjectId) saveExpandedDirs(activeProjectId, collapsedDirs);
  }


  async function deleteSidebarSession(projectId: string, session: SessionSummary) {
    await api.sessions.deleteRecord(session.id);
    removeSessionState(session.id);
    removeSessionComposerState(session.id);
    showToast(t("app.sessionDeleted"), 2200);
    await refreshProjectSessions(projectId);
  }

  function requestDeleteSidebarSession(projectId: string, session: SessionSummary) {
    const childCount = getProjectSessionRecords(projectId).filter((candidate) =>
      isSameSessionPath(
        candidate.parentSessionPath,
        session.filePath,
        candidate.wsl ? "wsl" : "native",
      ),
    ).length;
    if (childCount === 0) {
      void deleteSidebarSession(projectId, session);
      return;
    }
    setConfirmDialog({
      title: t("drawer.sessionDeleteTitle"),
      message: t("drawer.sessionDeleteBodyWithChildren", {
        name: session.name || t("common.untitled"),
        count: childCount,
      }),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: () => {
        setConfirmDialog(null);
        void deleteSidebarSession(projectId, session);
      },
    });
  }

  async function toggleProjectWorktree(project: Project) {
    try {
      const updated = await api.projects.toggleWorktreeEnabled(project.id);
      if (!updated) return;
      setProjects(await api.projects.list());
      if (updated.worktreeEnabled) void refreshWorktrees(updated.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("NOT_A_GIT_REPO")) {
        showToast(t("app.worktreeNotGitRepo"), 5000);
      } else {
        showToast(message, 5000);
      }
    }
  }

  async function removeSidebarProject(project: Project) {
    try {
      const next = await api.projects.remove(project.id);
      setProjects(next);
      updateAfterProjectRemoved(project.id, next);
    } catch (error) {
      if (String(error instanceof Error ? error.message : error).includes("PROJECT_HAS_RUNNING_AGENT")) {
        setConfirmDialog({
          title: t("app.projectRemoveBlockedTitle"),
          message: t("app.projectRemoveBlockedByAgent"),
          confirmLabel: t("app.projectRemoveBlockedAck"),
          onConfirm: () => setConfirmDialog(null),
        });
      } else {
        showToast(error instanceof Error ? error.message : String(error), 5000);
      }
    }
  }

  const sidebarActions: SidebarActions = {
    projects: {
      add: addProject,
      select: (projectId) => {
        selectProjectCommand(projectId);
        if (getProjectSessionRecords(projectId).length === 0) {
          void refreshProjectSessions(projectId).catch(() => undefined);
        }
      },
      refresh: async (projectId) => {
        const project = projects.find((candidate) => candidate.id === projectId);
        if (project) await refreshProjectTree(project);
      },
      reorder: reorderProjects,
      reveal: (project) => api.files.showInFolder(project.path),
      openWithEditor: (project) => {
        setEditorsTargetPath(project.path);
        setEditorsAnchor({ x: 80, y: 80 });
        setEditorsOpen(true);
      },
      importSessions: (project, source) => {
        if (source === "codex") return openCodexImport(project);
        if (source === "claude") return openClaudeImport(project);
        return openOpenCodeImport(project);
      },
      manageResources: (project) => setProjectResourcesProject(project),
      toggleWorktree: toggleProjectWorktree,
      copyPath: async (project) => {
        await navigator.clipboard.writeText(project.path);
        showToast(t("common.copied"));
      },
      remove: removeSidebarProject,
      changeChatPath: async (project) => {
        const picked = await api.projects.chooseChatPath();
        if (!picked || picked === project.path) return;
        await api.projects.setChatPath(picked);
        await refreshProjectSessions(project.id);
        showToast(t("app.chatProjectPathUpdated"), 1800);
      },
    },
    sessions: {
      open: runOpenSidebarSessionById,
      createDraft: runCreateSessionDraft,
      deleteDraft: deleteDraftSession,
      rename: openSessionRename,
      export: runExportSidebarSession,
      copy: runCopySidebarSession,
      copyPath: async (session) => {
        await navigator.clipboard.writeText(session.filePath);
        showToast(t("common.copied"));
      },
      openFile: (session) => api.files.open(session.filePath),
      delete: async (projectId, session) => {
        requestDeleteSidebarSession(projectId, session);
      },
    },
    agents: {
      rename: openAgentRename,
      export: (agent) => exportAgentHtml(agent.id),
      copySession: (agent) => cloneAgentSession(agent.id),
      copyPath: async (agent) => {
        if (!agent.sessionPath) return;
        await navigator.clipboard.writeText(agent.sessionPath);
        showToast(t("common.copied"));
      },
      openSessionFile: (agent) => agent.sessionPath ? api.files.open(agent.sessionPath) : Promise.resolve(),
      close: (agent) => closeAgent(agent.id),
    },
    worktrees: {
      create: async (projectId, branchName) => {
        await createWorktree(projectId, branchName);
      },
      remove: (parentProjectId, entry, childProject) => {
        requestRemoveWorktree(parentProjectId, entry.path, childProject);
        return Promise.resolve();
      },
    },
    rpc: {
      getLogging: (agentId) => api.rpcLogs.getLogging(agentId),
      setLogging: (agentId, enabled) => api.rpcLogs.setLogging(agentId, enabled),
      openLogFile: (agentId) => api.rpcLogs.openFile(agentId),
      listLogs: (agentId) => api.rpcLogs.get({ agentId }),
    },
  };

  function startResize(target: "list" | "drawer", event: PointerEvent) {
    const startX = event.clientX;
    const startListWidth = listCollapsed ? 68 : listWidth;
    const startDrawerWidth = drawerCollapsed ? 0 : drawerWidth;
    let frame = 0;

    function onMove(moveEvent: globalThis.PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const delta = moveEvent.clientX - startX;
        if (target === "list") {
          const next = Math.min(440, Math.max(100, startListWidth + delta));
          setListCollapsed(next <= 120);
          setListWidth(next);
        } else {
          const minDrawerWidth = drawerPinned ? 220 : 180;
          const next = Math.min(
            560,
            Math.max(minDrawerWidth, startDrawerWidth - delta),
          );
          setDrawerCollapsed(!drawerPinned && next <= 190);
          setDrawerWidth(next);
        }
      });
    }

    function onUp() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing");
      document.body.classList.remove("is-list-resizing");
    }

    document.body.classList.add("is-resizing");
    if (target === "list") document.body.classList.add("is-list-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startComposerResize(event: PointerEvent) {
    const startY = event.clientY;
    const startHeight = resolvedComposerHeight;
    let frame = 0;

    function onMove(moveEvent: globalThis.PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maxHeight = getComposerMaxHeight();
        // 拖动的是输入区顶部边线,鼠标向上意味着输入区变高;限制最大高度避免挤压会话阅读区域。
        // 实际高度由手动高度和自动内容高度共同决定;拖到最大后自动高度也会变大,
        // 因此手动缩小时必须同步覆盖 autoHeight,否则 Math.max 会继续把输入框顶在最大高度。
        const next = Math.min(
          maxHeight,
          Math.max(
            COMPOSER_MIN_HEIGHT,
            startHeight + startY - moveEvent.clientY,
          ),
        );
        setComposerHeight(next);
        setComposerAutoHeight(next);
      });
    }

    function onUp() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-composer-resizing");
    }

    document.body.classList.add("is-composer-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleListCollapsed() {
    const nextCollapsed = !listCollapsed;
    if (!nextCollapsed) setListWidth(DEFAULT_LIST_WIDTH);
    if (nextCollapsed) {
      // 点击折叠后鼠标和焦点仍在侧栏内;先释放焦点并抑制 hover,避免刚折叠就被 CSS 展开。
      (document.activeElement as HTMLElement | null)?.blur();
    }
    setListHoverRevealSuppressed(nextCollapsed);
    setListCollapsed(nextCollapsed);
  }

  function releaseListHoverSuppression(event: PointerEvent<HTMLDivElement>) {
    if (listCollapsed && listHoverRevealSuppressed && event.clientX > 24) {
      setListHoverRevealSuppressed(false);
    }
  }

  return (
    <div
      className={[
        "wechat-shell",
        drawer ? "drawer-open" : "",
        listCollapsed ? "list-collapsed" : "",
        listHoverRevealSuppressed ? "list-hover-suppressed" : "",
        drawerCollapsed ? "drawer-collapsed" : "",
        settings.useNativeTitleBar ? "" : "custom-titlebar-enabled",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerMove={releaseListHoverSuppression}
      style={
        {
          "--list-width": `${listCollapsed ? 0 : listWidth}px`,
          "--list-expanded-width": `${listWidth}px`,
          "--list-hover-width": `${Math.max(190, listWidth)}px`,
          // Grid 列宽过渡期间保留内容；退出结束后由 WorkspaceDrawerHost 延迟卸载。
          "--drawer-width": `${drawer && !drawerCollapsed ? drawerWidth : 0}px`,
          "--drawer-col-w": `${drawer && !drawerCollapsed ? 260 : 0}px`,
          "--drawer-splitter-w": `${drawer && !drawerCollapsed ? 6 : 0}px`,
        } as React.CSSProperties
      }
    >
      <AppHeader useNativeTitleBar={settings.useNativeTitleBar} toggleAlwaysOnTop={api.app.toggleAlwaysOnTopWindow} minimizeWindow={api.app.minimizeWindow} toggleMaximizeWindow={api.app.toggleMaximizeWindow} closeWindow={api.app.closeWindow} />
      <SidebarContent
        controller={sidebarController}
        actions={sidebarActions}
        currentProjectId={activeProjectId}
        currentSessionId={currentSessionId}
        worktreesByProject={worktreesByProject}
        branchByProject={branchByProject}
        creatingWorktree={worktreeCreating}
        isLanWeb={isLanWeb}
        chrome={<>
          <div className="list-toolbar">
            <div className="app-badge">
              <LogoMark />
              <span className="brand-wordmark" aria-label="PiDeck">PiDeck</span>
            </div>
          </div>
          <button
            className="collapse-button list-collapse"
            title={listCollapsed ? t("app.expandList") : t("app.collapseList")}
            onClick={toggleListCollapsed}
          >
            {listCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </>}
        onPointerLeave={() => {
          if (listHoverRevealSuppressed) setListHoverRevealSuppressed(false);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenConfig={() => setConfigOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenHomepage={() => void api.app.openExternal("https://ayuayue.github.io/PiDeck/")}
      />
      <div
        className="splitter splitter-left"
        onPointerDown={(event) => startResize("list", event)}
      />

      <main
        ref={chatPaneRef}
        className="chat-pane"
        style={{
          "--terminal-row-h": `${terminalRowHeight}px`,
          ...(settings.contentMaxWidth > 0 && settings.contentMaxWidth < 1400
            ? { "--content-max-width": `${settings.contentMaxWidth}px` }
            : undefined),
        } as React.CSSProperties}
      >
        <SessionHeader
          headerRef={chatHeaderRef}
          comboRef={sessionComboRef}
          title={
            currentSession?.title ??
            (isChatProject(activeProject)
              ? t("app.chatProject")
              : activeProject?.name) ??
            "PiDeck"
          }
          compactionCount={activeAgent?.compactionCount}
          runtimeState={activeRuntimeState}
          duration={activeAgentId ? sessionDurationByAgent[activeAgentId] : undefined}
          isStarting={isAgentStarting}
          hasProject={Boolean(activeProjectId)}
          hasSession={Boolean(activeAgentId || currentSessionId)}
          menuOpen={sessionActionsOpen}
          canStop={activeAgent?.status === "running"}
          canRestart={Boolean(
            activeAgentId &&
            activeAgent &&
            activeAgent.status !== "starting" &&
            restartingAgentId !== activeAgentId &&
            !queueFlushByAgentRef.current.has(activeAgentId) &&
            !(queue.queuedPrompts[activeAgentId] ?? []).some(
              (queuedPrompt) =>
                queuedPrompt.status === "sending" ||
                queuedPrompt.status === "unknown",
            )
          )}
          isRestarting={restartingAgentId === activeAgentId}
          showRestart={!isLanWeb}
          onTrigger={() => {
            if (activeAgentId || currentSessionId) {
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
        />
        <NoticeCenter />

        {currentSessionId ? (
          <SessionMessageTimeline
            mode="session"
            sessionId={currentSessionId}
            controller={sessionTimeline}
            hasProject={Boolean(activeProjectId)}
            onCreateSession={() => void runCreateSessionDraft()}
            showThinking={settings.showThinking}
            validCommandNames={validCommandNames}
            validFilePaths={validFilePaths}
            onPreviewImage={setPreviewImage}
            onOpenExternal={(url) => api.app.openExternal(url)}
            onOpenFile={openFilePath}
            onDiffFile={diffFilePath}
            onResendUserMessage={canMutateActiveMessages ? resendUserMessage : undefined}
            onEditMessage={canMutateActiveMessages ? editMessage : undefined}
            onDeleteMessage={canMutateActiveMessages ? deleteMessage : undefined}
            onSendUiResponse={(requestId, response) => {
              if (!activeAgentId) return;
              if (response.cancelled) setCancellingUi(true);
              sendSessionUiResponse(requestId, response);
            }}
            onToast={(message) => showToast(message)}
          />
        ) : null}

          {sessionTimeline.showScrollToBottom && (
            <button
              className="scroll-to-bottom-btn"
              // 按钮脱离滚动容器后，由 composer 实际高度 + 终端高度决定 bottom，避免输入框增高或终端打开时遮挡。
              style={{ bottom: Math.max(24, terminalRowHeight + composerOffsetHeight + 18) }}
              onClick={sessionTimeline.scrollToBottom}
              title={t("app.scrollToBottom")}
            >
              <ChevronDown size={18} />
            </button>
          )}

        {hasActiveConversation && currentSessionId && (
          <ComposerArea
            ref={composerRef}
            sessionId={currentSessionId}
            onOpenFile={openFilePath}
            queuePanel={activeAgentId ? (
              <QueuedPromptPanel
                trackRef={queuedTrackRef}
                agentId={activeAgentId}
                prompts={activeQueuedPrompts}
                visiblePrompts={visibleQueuedPrompts}
                onRetract={queue.retractQueuedPromptForEdit}
                onDiscard={queue.discardQueuedPrompt}
              />
            ) : undefined}
          />
        )}

        {!isLanWeb && currentSessionId && !settingsOpen && !configOpen && !environmentDialog && terminalDockVisible && (
          <SessionRuntimeDock
            agentId={activeAgentId}
            open={terminalDockVisible}
            collapsed={terminalCollapsed}
            height={terminalRowHeight}
            terminal={api.terminal}
            onOpenChange={(open) => {
              if (activeAgentId) setTerminalOpenForAgent(activeAgentId, open);
            }}
            onCollapsedChange={(collapsed) => {
              if (activeAgentId) setTerminalCollapsedForAgent(activeAgentId, collapsed);
            }}
            onHeightChange={(height) => {
              if (!activeAgentId) return;
              const maxHeight = Math.max(
                120,
                chatLayoutHeight -
                  (chatHeaderRef.current?.offsetHeight ?? 78) -
                  COMPOSER_MIN_TIMELINE_HEIGHT -
                  COMPOSER_MIN_HEIGHT -
                  28 -
                  queuedChromeBudget,
              );
              setTerminalHeightByAgent((current) => ({
                ...current,
                [activeAgentId]: Math.min(height, maxHeight),
              }));
            }}
          />
        )}
      </main>

        {hasActiveConversation && (
          <ConversationOutline
            items={outlineItems}
            onJump={handleOutlineJump}
            extraAction={{
              active: scratchPad.isOpen,
              label: t("scratchPad.openTooltip"),
              onClick: () => scratchPad.toggle(),
              icon: <Pencil size={17} />,
            }}
            terminalAction={{
              active: terminalOpen,
              label: t("app.terminal"),
              onClick: () => {
                if (!activeAgentId) return;
                setTerminalOpenForAgent(activeAgentId, !terminalOpen);
              },
              icon: <Terminal size={17} />,
            }}
            filesAction={{
              active: drawer === "files",
              label: t("app.files"),
              onClick: () => {
                if (drawer === "files" && !drawerCollapsed) {
                  if (activeProjectId) saveDrawerState(activeProjectId, null, false);
                  setDrawer(null);
                } else {
                  openDrawer("files");
                  setDrawerCollapsed(false);
                }
              },
              icon: <FolderOpen size={17} />,
            }}
            gitAction={settings.enableGitManagement && activeProjectId && !isChatProject(activeProject) ? {
              active: drawer === "git",
              label: t("drawer.sourceControl"),
              onClick: () => {
                if (drawer === "git" && !drawerCollapsed) {
                  if (gitDrawerDiff) {
                    closeGitDiff();
                    return;
                  }
                  if (activeProjectId) saveDrawerState(activeProjectId, null, false);
                  setDrawer(null);
                } else {
                  openDrawer("git");
                  setDrawerCollapsed(false);
                }
              },
              icon: <GitBranch size={17} />,
            } : undefined}
            editorsAction={{
              active: editorsOpen,
              label: t("app.openWithEditor"),
              onClick: (e) => {
                const projectPath =
                  activeAgent?.cwd ||
                  (activeProject && !isChatProject(activeProject)
                    ? activeProject.path
                    : null);
                setEditorsTargetPath(projectPath);
                setEditorsOpen((open) => !open);
                const btn = (e?.currentTarget as HTMLElement)?.closest("button");
                if (btn) {
                  const rect = btn.getBoundingClientRect();
                  setEditorsAnchor(adjustMenuPos(rect.left - 4, rect.top, 220, 280));
                }
              },
              icon: <Code size={17} />,
            }}
            browserAction={{
              active: drawer === "browser",
              label: t("app.browser"),
              onClick: () => {
                if (drawer === "browser" && !drawerCollapsed) {
                  if (activeProjectId) saveDrawerState(activeProjectId, null, false);
                  setDrawer(null);
                } else {
                  setDrawer("browser");
                  setDrawerCollapsed(false);
                }
              },
              icon: <Globe size={17} />,
            }}
          />
        )}

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
        onCollapse={collapseDrawer}
        onClose={closeDrawer}
        onRestore={() => setDrawerCollapsed(false)}
        onTogglePin={toggleDrawerPinned}
        renderPanel={() => (
        <>
        {editorMode === "drawer" && drawer === "editor" && !drawerCollapsed && activeTab ? (
          <Suspense fallback={<div className="drawer-content-frame"><div className="file-diff-loading">Loading...</div></div>}>
            <FileDiffViewer
              displayMode="drawer"
              filePath={activeTab.filePath}
              mode={activeTab.mode}
              onToggleMode={activeTab.preserveDrawer ? undefined : toggleEditorMode}
              onBack={prevDrawerPanelRef.current && prevDrawerPanelRef.current !== "editor" ? () => {
                const prev = clearEditorBack();
                if (prev) setDrawer(prev);
              } : undefined}
              originalContent={activeTab.mode === "diff" ? activeTab.originalContent : undefined}
              modifiedContent={activeTab.modifiedContent}
              tabs={editorTabs}
              activeTabId={activeTabId}
              onSelectTab={selectEditorTab}
              onCloseTab={closeEditorTab}
              onClose={() => { closeEditor(); setDrawer(null); }}
              readContent={readEditorFileContent}
              readOriginalContent={readEditorOriginalContent}
              saveContent={activeTab.allowSave ? saveEditorFileContent : undefined}
              theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"}
              maxFileSizeMB={settings.maxEditorFileSizeMB}
            />
          </Suspense>
        ) : drawer === "browser" && !drawerCollapsed && !browserFullscreen ? (
          <div className="drawer-content-frame">
            <BrowserPanel
              onClose={() => setDrawer(null)}
              onToggleFullscreen={() => setBrowserFullscreen(true)}
            />
          </div>
        ) : settings.enableGitManagement && drawer === "git" && !drawerCollapsed && activeProjectId ? (
          <div className="drawer-content-frame">
            <div className="drawer-header">
              <strong>{t("drawer.sourceControl")}</strong>
              <div className="drawer-header-actions">
                <button onClick={collapseDrawer} title={t("drawer.collapsePanel")}>
                  <Minus size={15} />
                </button>
                <button onClick={closeDrawer} title={t("common.close")}>
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="git-drawer-stack" data-detail-open={Boolean(gitDrawerDiff && gitDiffDisplayMode === "drawer")}>
              <div className="git-drawer-source" aria-hidden={Boolean(gitDrawerDiff && gitDiffDisplayMode === "drawer")}>
                <GitPanel
                  projectId={activeProjectId}
                  commitLog={api.git.commitLog}
                  commitDetail={api.git.commitDetail}
                  onOpenCommitFileDiff={openCommitFileDiff}
                  onOpenWorkspaceFileDiff={openWorkspaceFileDiff}
                  branchCompare={api.git.branchCompare}
                  getStatus={api.git.status}
                  stageFiles={api.git.stage}
                  unstageFiles={api.git.unstage}
                  discardFile={api.git.discard}
                  commit={api.git.commit}
                  branches={gitInfo.branches}
                  currentBranch={gitInfo.current}
                  onSwitchBranch={switchBranch}
                  onCreateBranch={createBranch}
                  cherryPick={api.git.cherryPick}
                  revert={api.git.revert}
                  reset={api.git.reset}
                  dropCommit={api.git.dropCommit}
                  generateCommitMessage={api.git.generateCommitMessage}
                  gitInit={api.git.init}
                />
              </div>
              {gitDrawerDiff && gitDrawerDiff.projectId === activeProjectId && gitDiffDisplayMode === "drawer" && (
                <div className="git-drawer-detail">
                  <Suspense fallback={<div className="file-diff-loading">Loading...</div>}>
                    <FileDiffViewer
                      displayMode="drawer"
                      filePath={gitDrawerDiff.filePath}
                      mode="diff"
                      onToggleMode={toggleGitDiffDisplayMode}
                      originalContent={gitDrawerDiff.originalContent}
                      modifiedContent={gitDrawerDiff.modifiedContent}
                      tabs={[{ id: gitDrawerDiff.filePath, filePath: gitDrawerDiff.filePath, label: gitDrawerDiff.label }]}
                      activeTabId={gitDrawerDiff.filePath}
                      onClose={closeGitDiff}
                      readContent={readEditorFileContent}
                      theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"}
                      maxFileSizeMB={settings.maxEditorFileSizeMB}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        ) : drawer && drawer !== "browser" && drawer !== "editor" && drawer !== "git" ? (
          <LazyWrapper
            className="drawer-content-frame"
            enabled={true}
            threshold={0}
            rootMargin="50px"
            placeholder={
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-secondary)",
                fontSize: "14px"
              }}>
                加载中...
              </div>
            }
          >
            <DrawerContent
              panel={drawer}
              project={drawer === "sessions" ? sessionsProject : undefined}
              files={files}
              sessions={(sessionsProjectId && sessionSourceFilter[sessionsProjectId]) ? sessions.filter(
                (s) => !s.parentSessionPath && (sessionSourceFilter[sessionsProjectId]!)!.has(s.source ?? "pi"),
              ).concat(sessions.filter(s => s.parentSessionPath && (sessionSourceFilter[sessionsProjectId]!)!.has(s.source ?? "pi"))) : sessions}
              sessionsLoading={sessionHistoryLoading}
              expandedDirs={expandedDirs}
              onToggleDirectory={toggleDirectory}
              onCollapseAllDirectories={collapseAllDirectories}
              pinned={drawerPinned}
              onTogglePin={toggleDrawerPinned}
              onCollapse={collapseDrawer}
              onClose={closeDrawer}
              onFileContextMenu={(node, x, y) => setFileMenu({ node, x, y })}
              onRefreshFiles={() => {
                refreshFiles(activeProjectId);
              }}
              onOpenFolder={() => {
                const p = projects.find((p) => p.id === activeProjectId);
                if (p) void api.files.open(p.path);
              }}
              onRefreshSessions={() => {
                const projectId = sessionsProjectId ?? activeProjectId;
                if (projectId) void refreshProjectSessions(projectId, true);
              }}
              onOpenSession={(session) =>
                void runOpenSidebarSession(
                  sessionsProjectId ?? activeProjectId ?? "",
                  session,
                )
              }
              onRenameSession={async (filePath, newName) => {
                const session = sessions.find((candidate) =>
                  isSameSessionPath(
                    candidate.filePath,
                    filePath,
                    candidate.wsl ? "wsl" : "native",
                  ),
                );
                if (!session) return;
                await api.sessions.updateRecord(session.id, { title: newName });
                const projectId = sessionsProjectId ?? activeProjectId;
                if (projectId) await refreshProjectSessions(projectId, true);
              }}
              onCopySession={(session) =>
                runCopySession(
                  session.filePath,
                  sessionsProjectId ?? activeProjectId,
                )
              }
              onExportSession={runExportHistorySession}
              onDeleteSession={runDeleteHistorySession}
              onViewFile={viewFilePath}
              onOpenFile={openFilePath}
            />
          </LazyWrapper>
        ) : null}
        </>
        )}
      />
      {fileMenu && (
        <FileContextMenu
          menu={fileMenu}
          onClose={() => setFileMenu(null)}
          onOpen={() => {
            void api.files.open(fileMenu.node.path);
            setFileMenu(null);
          }}
          onReveal={() => {
            void api.files.showInFolder(fileMenu.node.path);
            setFileMenu(null);
          }}
          onAttach={() => {
            setPrompt(
              (current) =>
                `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}@${fileMenu.node.relativePath} `,
            );
            setFileMenu(null);
          }}
          onCopyPath={() => {
            void navigator.clipboard.writeText(fileMenu.node.path);
            setFileMenu(null);
            showToast(t("app.pathCopied"), 1200);
          }}
          onRename={() => {
            const node = fileMenu.node;
            setRenamingFile({ path: node.path, name: node.name });
            setRenamingFileInput(node.name);
            setFileMenu(null);
          }}
          onDelete={() => {
            const node = fileMenu.node;
            setFileMenu(null);
            setConfirmDialog({
              title: node.type === "directory" ? t("drawer.deleteFolderTitle") : t("drawer.deleteFileTitle"),
              message: node.type === "directory"
                ? t("drawer.deleteFolderConfirm", { name: node.name })
                : t("drawer.deleteFileConfirm", { name: node.name }),
              danger: true,
              confirmLabel: t("common.delete"),
              onConfirm: async () => {
                setConfirmDialog(null);
                try {
                  await api.files.delete(node.path, true);
                  void refreshFiles();
                  showToast(t("app.fileDeleted"), 2000);
                } catch (e) {
                  console.error("[File] 删除失败:", e);
                }
              },
            });
          }}
        />
      )}

      {projectResourcesProject && (
        <Suspense fallback={null}>
          <ProjectResourcesModal
            project={projectResourcesProject}
            onClose={() => setProjectResourcesProject(null)}
          />
        </Suspense>
      )}
      <RenameModals
        agentRename={(agentRenameTarget || sessionRenameTarget) ? {
          isAgent: !!agentRenameTarget,
          value: agentRenameValue,
          saving: agentRenaming,
          onValueChange: setAgentRenameValue,
          onClose: () => { setAgentRenameTarget(null); setSessionRenameTarget(null); },
          onSubmit: () => { if (agentRenameTarget) void submitAgentRename(); else void submitSessionRename(); },
        } : undefined}
        fileRename={renamingFile ? {
          path: renamingFile.path,
          name: renamingFile.name,
          inputValue: renamingFileInput,
          onInputChange: setRenamingFileInput,
          onClose: () => setRenamingFile(null),
          onConfirm: (path, newName) => {
            void api.files.rename(path, newName).then(() => {
              void refreshFiles();
              setRenamingFile(null);
              showToast(t("app.fileRenamed"), 2000);
            }).catch((err) => console.error("[File] rename failed:", err));
          },
        } : undefined}
      />

      {/* old conditional wrapping — replaced by EnvironmentOverlay open prop below */}
      <EnvironmentOverlay open={environmentDialog}>
        <EnvironmentDialog
          status={piStatus}
          checking={piChecking}
          onClose={() => {
            setEnvironmentDialog(false);
            piUpdate.setCustomPathResult(null);
            // 关闭时重置安装状态
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
            piUpdate.setNpmAvailable(null);
          }}
          onRecheck={() => {
            piUpdate.setCustomPathResult(null);
            piUpdate.setNpmAvailable(null);
            piUpdate.setNpmVersion(undefined);
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
            piUpdate.setInstallUseMirror(false);
            piUpdate.checkPiInstall("manual");
          }}
          onOpenInstallDocs={() =>
            api.app.openExternal(
              "https://pi.dev/docs/latest/quickstart#install",
            )
          }
          customPath={piUpdate.customPiPath}
          customPathValidating={piUpdate.customPathValidating}
          customPathResult={piUpdate.customPathResult}
          onCustomPathChange={(path) => {
            piUpdate.setCustomPiPath(path);
            piUpdate.setCustomPathResult(null);
          }}
          onValidateCustomPath={() =>
            piUpdate.validateCustomPiPath({ closeDialogOnSuccess: true })
          }
          npmAvailable={piUpdate.npmAvailable}
          npmVersion={piUpdate.npmVersion}
          npmChecking={piUpdate.npmChecking}
          installCommand={piUpdate.installCommand}
          installUseMirror={piUpdate.installUseMirror}
          installExecuting={piUpdate.installExecuting}
          installResult={piUpdate.installResult}
          installCompleted={piUpdate.installCompleted}
          onCheckNpm={piUpdate.checkNpm}
          onInstallCommandChange={(cmd) => {
            piUpdate.setInstallCommand(cmd);
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
          }}
          onToggleInstallMirror={() => {
            piUpdate.setInstallUseMirror((prev) => {
              if (prev) {
                piUpdate.setInstallCommand((cmd) =>
                  cmd.replace(
                    /\s+--registry=https:\/\/registry\.npmmirror\.com/g,
                    "",
                  ),
                );
              } else {
                piUpdate.setInstallCommand((cmd) =>
                  cmd.includes("--registry=")
                    ? cmd
                    : cmd + " --registry=https://registry.npmmirror.com",
                );
              }
              return !prev;
            });
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
          }}
          onExecInstall={piUpdate.execInstallCommand}
          onRestartApp={() => api.app.restart()}
          onClearCheckFlag={async () => {
            await api.settings.update({ piEnvironmentChecked: false });
            showToast(t("environment.checkFlagCleared"));
          }}
        />
      </EnvironmentOverlay>
      {currentSessionId && sessionRuntimeUiResponder && (
        <SessionRuntimeUiOverlay
          sessionId={currentSessionId}
          runtime={currentSessionRuntime}
          ui={currentSessionRuntimeUi}
          responder={sessionRuntimeUiResponder}
        />
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
        <SettingsModal
          settings={settings}
          piStatus={piStatus}
          piChecking={piChecking}
          piProxyChecking={piUpdate.piProxyChecking}
          piProxyNotice={piUpdate.piProxyNotice}
          piProxyNoticeTone={piUpdate.piProxyNoticeTone}
          webServiceChanging={webServiceChanging}
          appInfo={appInfo}
          customPiPath={piUpdate.customPiPath}
          customPathValidating={piUpdate.customPathValidating}
          customPathResult={piUpdate.customPathResult}
          updateChecking={updateChecking}
          piUpdating={piUpdate.piUpdating}
          piUpdateChecking={piUpdate.piUpdateChecking}
          piUpdateCheck={piUpdate.piUpdateCheck}
          piUpdateResult={piUpdate.piUpdateResult}
          onCustomPathChange={(path) => {
            piUpdate.setCustomPiPath(path);
            piUpdate.setCustomPathResult(null);
          }}
          onValidateCustomPath={() => piUpdate.validateCustomPiPath()}
          onClearCustomPath={piUpdate.clearCustomPiPath}
          onCheckPi={piUpdate.checkPiInstallInline}
          onTestPiProxy={() => piUpdate.testPiProxy()}
          onCheckUpdate={() => checkAppUpdate("manual")}
          onCheckPiUpdate={piUpdate.checkPiCliUpdate}
          onUpdatePi={piUpdate.updatePiCli}
          onToggleDevTools={async () => {
            const opened = await api.app.toggleDevTools();
            showToast(
              opened ? t("app.devToolsOpened") : t("app.devToolsClosed"),
            );
          }}
          onRestartApp={() => api.app.restart()}
          onClearCheckFlag={async () => {
            await api.settings.update({ piEnvironmentChecked: false });
            showToast(t("environment.checkFlagCleared"));
          }}
          onOpenWebService={(port) =>
            api.app.openExternal(`http://127.0.0.1:${port}`)
          }
          onClose={() => {
            setSettingsOpen(false);
          }}
          onChange={updateSettings}
        />
      </Suspense>
      )}
      <SessionActionOverlays
        feedback={feedbackOpen ? { open: true, project: activeProject, appInfo, onClose: () => setFeedbackOpen(false), onCopy: () => showToast(t("app.feedbackCopied")), onOpenExternal: (url) => api.app.openExternal(url), loadEnvironment: api.app.feedbackEnvironment } : undefined}
        confirm={confirmDialog ? { open: true, props: { title: confirmDialog.title, message: confirmDialog.message, onConfirm: confirmDialog.onConfirm, onCancel: () => setConfirmDialog(null), danger: confirmDialog.danger, confirmLabel: confirmDialog.confirmLabel } } : undefined}
        trust={trustRequest ? { open: true, requestId: trustRequest.requestId, cwd: trustRequest.cwd, projectName: trustRequest.projectName, onChoose: (choice) => { api.agents.respondTrustRequest(trustRequest.requestId, choice); setTrustRequest(null); } } : undefined}
      />
      <AppUpdateOverlay
        controller={appUpdateController}
        releasesUrl={appInfo.releasesUrl}
        openExternal={(url) => api.app.openExternal(url)}
        upToDateVersion={upToDateVersion}
        onDismissUpToDate={() => setUpToDateVersion(null)}
      />
      {editorMode === "modal" && activeTab && gitDiffDisplayMode !== "modal" && (
        <Suspense fallback={<div className="modal-backdrop"><span className="file-diff-loading">Loading...</span></div>}>
        <FileDiffViewer
          displayMode="modal"
          filePath={activeTab.filePath}
          mode={activeTab.mode}
          onToggleMode={activeTab.preserveDrawer ? undefined : toggleEditorMode}
          originalContent={activeTab.mode === "diff" ? activeTab.originalContent : undefined}
          modifiedContent={activeTab.modifiedContent}
          tabs={editorTabs}
          activeTabId={activeTabId}
          onSelectTab={selectEditorTab}
          onCloseTab={closeEditorTab}
          onClose={() => { closeEditor(); }}
          readContent={readEditorFileContent}
          readOriginalContent={readEditorOriginalContent}
          saveContent={activeTab.allowSave ? saveEditorFileContent : undefined}
          theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"}
          maxFileSizeMB={settings.maxEditorFileSizeMB}
        />
      </Suspense>
      )}
      {gitDiffDisplayMode === "modal" && gitDrawerDiff && gitDrawerDiff.projectId === activeProjectId && (
        <Suspense fallback={<div className="modal-backdrop"><span className="file-diff-loading">Loading...</span></div>}>
          <FileDiffViewer
            displayMode="modal"
            filePath={gitDrawerDiff.filePath}
            mode="diff"
            onToggleMode={toggleGitDiffDisplayMode}
            originalContent={gitDrawerDiff.originalContent}
            modifiedContent={gitDrawerDiff.modifiedContent}
            tabs={[{ id: gitDrawerDiff.filePath, filePath: gitDrawerDiff.filePath, label: gitDrawerDiff.label }]}
            activeTabId={gitDrawerDiff.filePath}
            onClose={closeGitDiff}
            readContent={readEditorFileContent}
            theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"}
            maxFileSizeMB={settings.maxEditorFileSizeMB}
          />
        </Suspense>
      )}
      {previewImage && (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {codexImportProject && <ImportOverlayHost kind="codex" project={codexImportProject} controller={codexImportController as any} onClose={() => setCodexImportProject(null)} />}
      {claudeImportProject && <ImportOverlayHost kind="claude" project={claudeImportProject} controller={claudeImportController as any} onClose={() => setClaudeImportProject(null)} />}
      {openCodeImportProject && <ImportOverlayHost kind="opencode" project={openCodeImportProject} controller={openCodeImportController as any} onClose={() => setOpenCodeImportProject(null)} />}
      <Suspense fallback={null}>
      <ConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={() => {
          // 配置保存后不再自动 reload,用户可通过 Restart 按钮手动重载
        }}
      />
      </Suspense>



      {/* Scratch Pad（草稿本）：根级渲染，避免受 chat-pane grid 影响定位 */}
      <ScratchPadOverlay controller={scratchPad} />

      {/* 外部编辑器选择气泡 */}
      {editorsOpen && editorsAnchor && (
        <div
          ref={editorsRef}
          className="editors-popover"
          style={{
            position: "fixed",
            left: editorsAnchor.x,
            top: editorsAnchor.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {externalEditors.length === 0 ? (
            <div className="editors-popover-empty">{t("app.noExternalEditors")}</div>
          ) : (
            externalEditors.map((editor) => (
              <button
                key={editor.id}
                className="editors-popover-item"
                onClick={() => {
                  const projectPath = editorsTargetPath;
                  if (projectPath) {
                    void api.editors.openProject(editor, projectPath).catch((error) => {
                      showToast(
                        t("app.openEditorFailed", {
                          error: error instanceof Error ? error.message : String(error),
                        }),
                        3000,
                      );
                    });
                  }
                  setEditorsOpen(false);
                  setEditorsAnchor(null);
                  setEditorsTargetPath(null);
                }}
              >
                <span className={`editor-logo ${editor.id}`}>
                  {getEditorLogoUrl(editor.id) ? (
                    <img src={getEditorLogoUrl(editor.id)} alt="" />
                  ) : (
                    editor.id.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span>{editor.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 浏览器全屏覆盖层 */}
      {browserFullscreen && (
        <div className="modal-backdrop" onClick={() => setBrowserFullscreen(false)}>
          <div className="browser-modal" onClick={(e) => e.stopPropagation()}>
            <BrowserPanel
              isFullscreen
              onClose={() => setBrowserFullscreen(false)}
              onMinimize={() => {
                setBrowserFullscreen(false);
                setDrawer("browser");
                setDrawerCollapsed(false);
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
}





// test
