import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ChevronLeft,
  ChevronRight,
  Code,
  FolderOpen,
  Globe,
  Pencil,
  Terminal,
  GitBranch,
} from "lucide-react";
import { showNotice } from "./utils/notice";
import {
  desktopApi as api,
  isLanWeb,
  missingElectronPreload,
} from "./desktopApi";
const ConfigModal = lazy(() => import("./ConfigModal").then((m) => ({ default: m.ConfigModal })));
import {
  SidebarContent,
  type SidebarActions,
} from "./components/sidebar/SidebarContent";
import { useGlobalAgentListeners } from "./hooks/useGlobalAgentListeners";
import { useRename } from "./hooks/useRename";
import { useSidebarController } from "./hooks/useSidebarController";
import { useProjectRuntimeCapabilities } from "./hooks/useRuntimeCapabilities";
import { useSessionRuntimeBridge } from "./hooks/useSessionRuntimeBridge";
import { useSessionLayout } from "./hooks/useSessionLayout";
import { useFileEditor } from "./hooks/useFileEditor";
import { useOverlayActions } from "./hooks/useOverlayActions";
import { useWorkspacePanels, type WorkspaceDrawerPanel } from "./hooks/useWorkspacePanels";
import { useTerminalDock } from "./hooks/useTerminalDock";
import { useImportFlow } from "./hooks/useImportFlow";
import { useQueuedPrompt, type QueuedPrompt } from "./hooks/useQueuedPrompt";
import { activeAgentIdAtom } from "./hooks/useSessionRuntimeController";
import { PromptDeliveryUnknownError } from "./utils/promptErrors";

import { usePiUpdate } from "./hooks/usePiUpdate";
import { useAppUpdateController } from "./hooks/useAppUpdateController";
import { useProjectSync } from "./hooks/useProjectSync";
import {
  agentInventoryAtom,
  applyRuntimeCapabilityAtom,
  claimSessionRuntimeUiResponseAtom,
  currentSessionAtom,
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
  runtimeCapabilityByAgentIdAtomFamily,
  rollbackSessionRuntimeUiResponseAtom,
  sessionRecordByIdAtomFamily,
  sessionRecordsByProjectIdAtomFamily,
  sessionIdByRuntimeAgentIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSummariesByProjectIdAtomFamily,
  setSessionAttachmentsAtom,
  setSessionCatalogLoadStateAtom,
  setSessionDraftAtom,
  upsertAgentInventoryAtom,
  upsertSessionAtom,
} from "./atoms";
import {
  buildComposerPromptSubmission,
} from "./composerBehavior";
import {
  isSameSessionPath,
} from "./agentListDisplay";
import { resolveLocale, setI18nLocale, t } from "./i18n";
import {
  isChatProject,
  loadSessionSourceFilter,
  saveSessionSourceFilter,
  isReplacementForPendingAgent,
  isPendingAgentId,
  migrateAgentRecord,
  COMPOSER_MIN_HEIGHT,
  type PendingAgentTab,
} from "./rendererUtils";
import {
  migrateQueuedPrompts,
} from "./utils/queuedPromptQueue";
import { useResize } from "./hooks/useResize";
import { useSessionTimelineController } from "./hooks/useSessionTimelineController";
import { useSessionActions } from "./hooks/useSessionActions";
import { useScratchPad } from "./hooks/useScratchPad";
import { SessionView } from "./components/session/SessionView";
import { SessionRuntimeInjector } from "./components/session/SessionRuntimeInjector";
import {
  QueuedPromptPanel,
} from "./components/session/ComposerPanels";
import { ScratchPadOverlay } from "./components/overlays/ScratchPadOverlay";
import { AppShell } from "./components/app/AppShell";
import { DrawerSurface } from "./components/workspace/DrawerSurface";
import { RenameModals } from "./components/RenameModals";
import { SessionActionOverlays } from "./components/overlays/SessionActionOverlays";
import { AppUpdateOverlay } from "./components/overlays/AppUpdateOverlay";
import { ImportOverlayHost } from "./components/overlays/ImportOverlayHost";
import { EnvironmentOverlay } from "./components/overlays/EnvironmentOverlay";
import { SessionRuntimeUiOverlay, createSessionRuntimeUiResponder } from "./components/overlays/SessionRuntimeUiOverlay";
import {
  ConversationOutline,
  EnvironmentDialog,
  FileContextMenu,
  ImagePreviewModal,
  LogoMark,
  type SessionModifiedFile,
} from "./components/app/AppParts";
import { ExternalEditorOverlay } from "./components/workspace/ExternalEditorOverlay";
import { navigateTo } from "./components/app/BrowserPanel";
import {
  buildOutline,
  flattenFiles,
  matches,
  mergeCommands,
  getToolFilePath,
  getToolNewContent,
  getToolChangedLineCount,
} from "./components/app/AppUtils";
// 懒加载：Monaco Editor（~17.6MB Web Worker）仅在用户打开 diff 时才加载
const FileDiffViewer = lazy(() => import("./components/app/FileDiffViewer").then((m) => ({ default: m.FileDiffViewer })));
// 懒加载模态框，减少首屏 JS 体积
const SettingsModal = lazy(() => import("./components/app/SettingsModal").then((m) => ({ default: m.SettingsModal })));

const ProjectResourcesModal = lazy(() => import("./components/app/ProjectResourcesModal").then((m) => ({ default: m.ProjectResourcesModal })));
import { createDefaultExternalEditorSettings } from "../../shared/types";
import type {
  AgentRuntimeState,
  AgentTab,
  AgentUiResponse,
  AppInfo,
  AppSettings,
  ChatMessage,
  FileTreeNode,
  ImageContent,
  PiCommand,
  Project,
  SessionRecord,
  SessionSummary,
  ComposerAgentMode,
} from "../../shared/types";

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
  // Composer input state is owned by ComposerArea; the root does not subscribe to each key.
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const currentSessionRuntime = useAtomValue(currentSessionRuntimeAtom);
  const currentSessionRuntimeRef = useRef(currentSessionRuntime);
  currentSessionRuntimeRef.current = currentSessionRuntime;
  const currentSessionRuntimeUi = useAtomValue(currentSessionRuntimeUiAtom);
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
  const removeSessionState = useSetAtom(removeSessionStateAtom);
  const sessionRuntimeUiResponder = useMemo(() => {
    if (!currentSessionId || !currentSessionRuntime?.agentId || currentSessionRuntime.runtimeGeneration == null) return undefined;
    const b = { sessionId: currentSessionId, agentId: currentSessionRuntime.agentId, runtimeGeneration: currentSessionRuntime.runtimeGeneration };
    return createSessionRuntimeUiResponder({ binding: b, readBinding: () => { const r = currentSessionRuntimeRef.current; return r?.agentId ? { sessionId: currentSessionId, agentId: r.agentId, runtimeGeneration: r.runtimeGeneration } : undefined; }, claim: (i) => claimSessionUiResponse(i), rollback: (i) => rollbackSessionUiResponse(i), send: async (i) => sendSessionUiResponse(i.requestId, i.response) });
  }, [currentSessionId, currentSessionRuntime?.agentId, currentSessionRuntime?.runtimeGeneration, claimSessionUiResponse, rollbackSessionUiResponse]);
  const removeSessionComposerState = useSetAtom(removeSessionComposerStateAtom);
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
  const activeAgentId = useAtomValue(activeAgentIdAtom);
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
  const collapsedProjects = sidebarController.collapsedProjectIds;

  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [promptTemplateList, setPromptTemplateList] = useState<
    Array<{ name: string; path: string; description: string; content: string; argumentHint?: string }>
  >([]);
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);
  // TECH DEBT (Phase 3): promptByAgent is a legacy draft path for non-Session agents.
  // Session drafts go through setSessionDraft→sessionDraftByIdAtom.
  // When all agents migrate to Session model, remove promptByAgent and unify to atom path.
  const [promptByAgent, setPromptByAgent] = useState<Record<string, string>>(
    {},
  );
  // contentEditable 的实时值通过 livePromptByAgentRef 保持最新，发送路径始终从这里读取草稿。
  // promptByAgent 仅用于驱动 RichInput 的 chip 渲染（非文本同步），只在 chips 变化时更新。
  const livePromptByAgentRef = useRef<Record<string, string>>({});

  /** 当前正在重启的 Agent，用于仅给对应会话显示 loading，避免切到其他 Agent 后仍被全局禁用。 */
  const [restartingAgentId, setRestartingAgentId] = useState<string | null>(null);
  // TECH DEBT (Phase 3): attachedImagesByAgent is a legacy draft path for non-Session agents.
  // Session attachments go through setSessionAttachments. Same dual-write pattern as promptByAgent.
  // When all agents migrate to Session model, remove attachedImagesByAgent and unify.
  const [attachedImagesByAgent, setAttachedImagesByAgent] = useState<
    Record<string, ImageContent[]>
  >({});
  const attachedImagesByAgentRef = useRef<Record<string, ImageContent[]>>(attachedImagesByAgent);
  attachedImagesByAgentRef.current = attachedImagesByAgent;
  const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);

  /** Legacy agent queue mode remains local until the final non-Session path is removed. */
  const [composerAgentModes, setComposerAgentModes] = useState<Record<string, ComposerAgentMode>>({});
  const setComposerAgentModeForAgent = (agentId: string, mode: ComposerAgentMode) => {
    setComposerAgentModes((prev) => ({ ...prev, [agentId]: mode }));
  };
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
  const search = sidebarController.search;

  // 记录 composer 光标位置,用于光标相关的 @ / 触发检测与建议项替换。
  const [fileMenu, setFileMenu] = useState<{
    x: number;
    y: number;
    node: FileTreeNode;
  } | null>(null);
  const [renamingFile, setRenamingFile] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [renamingFileInput, setRenamingFileInput] = useState("");
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

  // Drawer state delegated to useWorkspacePanels.
  const workspace = useWorkspacePanels({ projectId: activeProjectId });
  const drawer = workspace.drawer;
  const drawerCollapsed = workspace.drawerCollapsed;
  const drawerPinned = workspace.drawerPinned;
  const drawerPinnedPanel = workspace.drawerPinnedPanel;
  const browserFullscreen = workspace.browserFullscreen;
  const externalEditors = workspace.externalEditors;
  const editorsOpen = workspace.externalEditorsOpen;
  const editorsAnchor = workspace.externalEditorsAnchor;
  const editorsTargetPath = workspace.externalEditorsTargetPath;
  // Adapters for useFileEditor (expects setDrawer/setDrawerCollapsed).
  const setDrawer = useCallback((panel: WorkspaceDrawerPanel | null) => {
    // Open guard for git is handled by the enableGitManagement effect below.
    if (panel) workspace.openDrawer(panel);
    else workspace.closeDrawer();
  }, [workspace.openDrawer, workspace.closeDrawer]);
  const setDrawerCollapsed = useCallback((collapsed: boolean) => {
    if (collapsed) workspace.collapseDrawer();
    else workspace.expandDrawer();
  }, [workspace.collapseDrawer, workspace.expandDrawer]);
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
    setProjectMenu: () => undefined,
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

  const rename = useRename({
    renameAgent: (id, name) => api.agents.rename(id, name),
    renameSession: (id, name) => api.sessions.updateRecord(id, { title: name }),
    showToast,
    upsertAgent,
    refreshProjectSessions,
    closeAgentMenu: () => undefined,
  });

  const getProjectSessions = (projectId: string) =>
    store.get(sessionSummariesByProjectIdAtomFamily(projectId));
  const getProjectSessionRecords = (projectId: string) =>
    store.get(sessionRecordsByProjectIdAtomFamily(projectId));
  const getSessionRecord = (sessionId: string) =>
    store.get(sessionRecordByIdAtomFamily(sessionId));
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const appUpdate = useAppUpdateController({
    checkUpdate: api.app.checkUpdate,
    downloadUpdate: (asset) => api.app.downloadUpdate(asset),
    installUpdate: (filePath) => api.app.installUpdate(filePath),
    onUpdateProgress: (cb) => api.app.onUpdateProgress(cb),
    openExternal: (url) => api.app.openExternal(url),
  }, false);

  // upToDateVersion: hook does not expose this; used by AppUpdateOverlay for "up to date" toast.
  const [upToDateVersion, setUpToDateVersion] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const PROJECT_EXPANDED_DIRS_KEY_PREFIX = "pid:project-expanded-dirs:";

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

  // Guard: hide git drawer when git management is disabled.
  // Equivalent to: if (panel === "git" && !settings.enableGitManagement) return
  // Pinned cleanup (filter(([, panel]) => panel !== "git")) is handled inside useWorkspacePanels.
  useEffect(() => {
    if (settings.enableGitManagement) return;
    // setDrawer((current) => current === "git" ? null : current)
    if (drawer === "git") workspace.closeDrawer();
  }, [settings.enableGitManagement, drawer, workspace.closeDrawer]);

  /* settingsNotice 已改用 showToast (app-notice) 实现 */
  const [webServiceChanging, setWebServiceChanging] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    version: "-",
    releasesUrl: "https://github.com/ayuayue/pi-desktop/releases",
    platform: "win32",
  });
  const [systemLanguage, setSystemLanguage] = useState<string | null>(null);
  const resolvedLocale = resolveLocale(settings.language, systemLanguage ?? undefined);
  setI18nLocale(resolvedLocale);

  // ===== Pi 更新/安装/代理 hook (H1) =====
  const piUpdate = usePiUpdate({
    settings,
    setSettings,
    setSettingsOpen,
    showToast,
    api,
  });
  const { piStatus, piChecking, environmentDialog, setPiStatus, setEnvironmentDialog } = piUpdate;
  const [drawerWidth, setDrawerWidth] = useState(270);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [composerOffsetHeight, setComposerOffsetHeight] = useState(0);
  /** ResizeObserver 驱动布局预算重新计算；ref 尺寸本身变化不会触发 React render。 */
  const [composerAutoHeight, setComposerAutoHeight] =
    useState(COMPOSER_MIN_HEIGHT);
  const {
    terminalOpen,
    terminalCollapsed,
    terminalDockVisible,
    terminalDockClosing,
    terminalRowHeight: activeTerminalHeight,
    setTerminalOpenForAgent,
    setTerminalCollapsedForAgent,
    setTerminalHeightByAgent,
    prune: pruneTerminalDockState,
  } = useTerminalDock(activeAgentId);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const sessionComboRef = useRef<HTMLDivElement | null>(null);
  const queuedTrackRef = useRef<HTMLDivElement | null>(null);

  const composerTextareaRef = useRef<HTMLDivElement | null>(null);
  // RichInput 受控重渲染后,光标应恢复到的纯文本偏移(供建议选中/清除后恢复选区)。
  const pendingComposerCaretRef = useRef<number | null>(null);
  const pendingAgentsRef = useRef<PendingAgentTab[]>([]);

  const scratchPad = useScratchPad();

  // Drawer loading handled by useWorkspacePanels; only expandedDirs logic remains.
  useEffect(() => {
    if (!activeProjectId) {
      setExpandedDirs(new Set());
      return;
    }
    const dirs = loadExpandedDirs(activeProjectId);
    setExpandedDirs(dirs);
  }, [activeProjectId, loadExpandedDirs]);

  const activeProjectRuntimeCapabilities = useProjectRuntimeCapabilities(activeProjectId);
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const overlays = useOverlayActions({ activeProject, appInfo, showToast });
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
  // 查看器已移除：activeAgent 直接从 displayAgents / pendingAgents 取，不再有伪 Agent。
  const activeAgent = activeAgentId
    ? [...displayAgents, ...pendingAgents].find((agent) => agent.id === activeAgentId)
    : undefined;

  // Timeline scroll, pagination and jump ownership lives in sessionTimeline.
  // Modern Session drafts and attachments are subscribed by ComposerArea; the root only
  // keeps the legacy queue adapter for agents that do not yet have a Session record.
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
      return;
    }
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


  function getComposerTargetId() {
    return currentSessionIdRef.current ?? activeAgentIdRef.current;
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


  // Queue ownership extracted to useQueuedPrompt.
  const queue = useQueuedPrompt({
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
    setComposerCursor: (v: React.SetStateAction<number>) => { /* no-op: cursor managed by composer controller */ },
    showToast,
    unknownDeliveryMessage: t("app.queuedUnknown"),
    dispatchPromptSnapshot,
  });
  const activeQueuedPrompts = activeAgentId
    ? (queue.queuedPrompts[activeAgentId] ?? [])
    : [];

  // Adapter: resolve sessionId → agentId for queue enqueue from modern ComposerArea.
  const enqueueSessionPrompt = useCallback((
    sessionId: string,
    snapshot: { displayText: string; message: string; images?: ImageContent[]; agentMode: string },
  ) => {
    const agentId = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId))?.agentId;
    if (!agentId) return false;
    return queue.enqueueQueuedPrompt(agentId, {
      id: crypto.randomUUID(),
      message: snapshot.message,
      displayText: snapshot.displayText,
      images: snapshot.images,
      behavior: "steer",
      agentMode: snapshot.agentMode as ComposerAgentMode,
      timestamp: Date.now(),
    });
  }, [store, queue.enqueueQueuedPrompt]);

  const activeMessages = sessionTimeline.messages;
  const agentRuntimeState = activeAgentId
    ? activeProjectRuntimeCapabilities[activeAgentId]
    : undefined;

  // activeConversationStatus / activeRuntimeState replaced by sync isAgentCurrentlyBusy().
  const hasActiveConversation = Boolean(currentSession);

  // Timeline scroll, pagination and jump ownership lives in sessionTimeline.
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

  // Runtime editor text is applied by useSessionComposerController, which owns the draft guard.

  // Layout calculation delegated to useSessionLayout (refs + ResizeObserver + math).
  const sessionLayout = useSessionLayout({
    terminalRequestedHeight: activeTerminalHeight,
    terminalOpen,
    terminalClosing: terminalDockClosing,
    terminalCollapsed,
    queuedPromptCount: activeQueuedPrompts.length,
  });
  const {
    chatPaneRef: sessionChatPaneRef,
    headerRef: sessionHeaderRef,
    composerRef: sessionComposerRef,
    composerBoxRef: sessionComposerBoxRef,
    queuedBudget: queuedChromeBudget,
    terminalRowHeight,
    maxComposerHeight,
    availableTerminalHeight,
    clampComposerHeight: sessionClampComposerHeight,
  } = sessionLayout;

  // Alias hook refs to the names App.tsx expects.
  const chatPaneRef = sessionChatPaneRef;
  const chatHeaderRef = sessionHeaderRef;
  const composerRef = sessionComposerRef;
  const composerBoxRef = sessionComposerBoxRef;

  const visibleQueuedPrompts = activeQueuedPrompts;
  const resolvedComposerHeight = Math.min(
    maxComposerHeight,
    Math.max(composerHeight, composerAutoHeight),
  );

  const {
    listWidth,
    setListWidth,
    listCollapsed,
    setListCollapsed,
    listHoverRevealSuppressed,
    setListHoverRevealSuppressed,
    startComposerResize,
    toggleListCollapsed,
    releaseListHoverSuppression,
  } = useResize({
    resolvedComposerHeight,
    maxComposerHeight,
    setComposerHeight,
    setComposerAutoHeight,
  });
  useEffect(() => {
    if (!workspace.drawerPinnedPanel) return;
    if (workspace.drawer !== workspace.drawerPinnedPanel) workspace.openDrawer(workspace.drawerPinnedPanel);
    if (workspace.drawerCollapsed) workspace.expandDrawer();
  }, [workspace.drawer, workspace.drawerCollapsed, workspace.drawerPinnedPanel]);

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
    activeProjectId,
    sessionsProjectId,
    projects,
    activeProjectSessions,
    sessionRefSelections,
    setActiveProjectId,
    setCurrentSessionId,
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
    pruneTerminalDockState(activeIds);
    // drawerPinnedByProject is managed internally by useWorkspacePanels; no-op cleanup.
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
    onAgentLog: () => undefined,
    onSettingsApplied: (next) => {
      setSettings(next);
      showToast(t("settings.restartNotice"));
    },
    onUpdateProgress: (_progress) => {
      // Hook useAppUpdateController subscribes via onUpdateProgress parameter;
      // nothing else needed here.
    },
    onOpenInBrowser: (url) => {
      workspace.openDrawer("browser");
      navigateTo(url);
    },
    onTrustRequest: overlays.setTrustRequest,
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
    void workspace.loadExternalEditors().catch(() => undefined);
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
          .then(() => workspace.loadExternalEditors())
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
    // When update check is disabled, skip periodic and deferred auto-check.
    if (settings.disableUpdateCheck) return;
    const timer = window.setInterval(
      () => void appUpdate.check("auto"),
      1000 * 60 * 60 * 6,
    );
    window.setTimeout(() => void appUpdate.check("auto"), 5000);
    return () => window.clearInterval(timer);
  }, [settings.disableUpdateCheck]);

  useEffect(() => {
    if (activeAgentId && !isPendingAgentId(activeAgentId))
      void refreshRuntimeState(activeAgentId);
  }, [activeAgentId]);

  useEffect(() => {
    const activeIds = new Set(displayAgents.map((agent) => agent.id));
    pruneTerminalDockState(activeIds);
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

  // Composer sizing is owned by ComposerArea and useSessionLayout.
  // 待发送轨道高度变化会改变 composer 的 chrome 高度；队列增删后重新 clamp，
  // 保证大量卡片出现时输入框仍留在可视区域，撤回后也不会保留过高尺寸。
  useLayoutEffect(() => {
    const maxHeight = maxComposerHeight;
    setComposerHeight((current) => Math.min(current, maxHeight));
    setComposerAutoHeight((current) => Math.min(current, maxHeight));
  }, [activeAgentId, activeQueuedPrompts.length]);

  // Outline jumps through the same timeline controller that owns pagination and scroll state.
  // Clamp composer height when layout changes (useSessionLayout handles ResizeObserver).
  useLayoutEffect(() => {
    setComposerHeight((current) => sessionClampComposerHeight(current));
    setComposerOffsetHeight(composerRef.current?.offsetHeight ?? 0);
  }, [sessionClampComposerHeight, composerRef]);

  useEffect(() => {
    if (activeAgentId && !isPendingAgentId(activeAgentId))
      void api.agents
        .commands(activeAgentId)
        // goal 模式这版先不公开入口；保留底层实现,等待官方 plan/goal 能力稳定后再决定是否恢复。
        .then((cmds) => setCommands(cmds))
        .catch(() => setCommands([]));
    else setCommands([]);
  }, [activeAgentId]);

  // 持久化会话来源过滤配置
  useEffect(() => {
    try {
      saveSessionSourceFilter(sessionSourceFilter);
    } catch (error) {
      // 静默失败
    }
  }, [sessionSourceFilter]);


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
      .catch((error) => console.error("[Files] refresh failed", error));
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
    setActiveProjectId(project.id);
    setSessionsProjectId(project.id);
    workspace.openDrawer("sessions");
    await refreshSessionHistory(project.id);
  }

  async function cloneAgentSession(agentId: string) {
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 5000);
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
      if (drawer === "sessions") workspace.closeDrawer();
    }
  }

  function applyAgentRuntimeState(agentId: string, incoming: AgentRuntimeState) {
    // applyRuntimeCapabilityAtom internally does mergeAgentRuntimeState.
    return applyRuntimeCapability({ agentId, state: incoming });
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

  async function compactAgent(compactPrompt?: string, agentId = activeAgentId) {
    if (!agentId || isPendingAgentId(agentId)) return;
    try {
      const state = await api.agents.compact(agentId, compactPrompt);
      applyAgentRuntimeState(agentId, state);
      showToast(t("app.compactDone"));
    } catch (e) {
      showToast(t("app.compactFailed"));
    }
  }

  async function closeAgent(agentId: string) {
    if (isPendingAgentId(agentId)) return;
    await api.agents.stop(agentId);
  }

  async function abortAgent(agentId = activeAgentId) {
    if (!agentId || isPendingAgentId(agentId)) return;
    // 立即清除流式状态，让思考气泡和 loading 立刻消失，不等后端 RPC 返回
    const previous = store.get(runtimeCapabilityByAgentIdAtomFamily(agentId));
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
    try {
      const result = await api.agents.exportHtml(agentId);
      showToast(t("app.exportedPath", { path: result.path }), 3500);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 5000);
    }
  }

  // isAgentBusy: synchronous store read (steer logic is callback-only, not render-time).
  function isAgentCurrentlyBusy(): boolean {
    if (!currentSessionId) return false;
    const rt = store.get(currentSessionRuntimeAtom);
    return rt?.status === "running" || Boolean((rt?.state as any)?.isStreaming);
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

  // Session prompt submission is owned by useSessionComposerController.

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
      (agentId === activeAgentId && isAgentCurrentlyBusy() ? "steer" : undefined);
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
    overlays.showConfirm({
      title: t("message.deleteTitle"),
      message: t("message.deleteReloadPrompt"),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        overlays.clearConfirm();
        try {
          await api.agents.deleteMessage(activeAgentId!, messageId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          showToast(`${t("message.deleteFailed")}: ${translateAgentErrorMessage(msg)}`, 5000);
        }
      },
    });
  }


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
    try {
      const next = await api.git.checkout(activeProjectId, branch);
      setGitInfo(next);
    } catch (error) {
      showToast(
        t("app.branchSwitchFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const refreshed = await api.git
        .branches(activeProjectId)
        .catch(() => ({ current: null, branches: [] }));
      setGitInfo(refreshed);
    }
  }

  async function createBranch(branchName: string) {
    if (!activeProjectId || !branchName.trim()) return;
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
    overlays.showConfirm({
      title: t("app.worktreeRemoveConfirmTitle"),
      message: t("app.worktreeRemoveConfirmMessage"),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: () => {
        overlays.clearConfirm();
        // 先触发淡出动画（添加 removing 类），等动画结束后再执行真实删除。
        setRemovingWorktreePaths((prev) => new Set(prev).add(worktreePath));
        setTimeout(() => {
          void removeWorktree(parentProjectId, worktreePath);
        }, 280);
      },
    });
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
    overlays.showConfirm({
      title: t("drawer.sessionDeleteTitle"),
      message: t("drawer.sessionDeleteBodyWithChildren", {
        name: session.name || t("common.untitled"),
        count: childCount,
      }),
      danger: true,
      confirmLabel: t("common.delete"),
      onConfirm: () => {
        overlays.clearConfirm();
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
        overlays.showConfirm({
          title: t("app.projectRemoveBlockedTitle"),
          message: t("app.projectRemoveBlockedByAgent"),
          confirmLabel: t("app.projectRemoveBlockedAck"),
          onConfirm: () => overlays.clearConfirm(),
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
        workspace.openExternalEditorChooser(project.path, { x: 80, y: 80 });
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
      rename: rename.openSessionRename,
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
      rename: rename.openAgentRename,
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

  const sidebarContentNode = (
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
      onOpenFeedback={() => overlays.setFeedbackOpen(true)}
      onOpenHomepage={() => void api.app.openExternal("https://ayuayue.github.io/PiDeck/")}
    />
  );

  // Gate 4.6 — Session view wrapped in SessionRuntimeInjector
  const sessionTitle =
    currentSession?.title ??
    (isChatProject(activeProject)
      ? t("app.chatProject")
      : activeProject?.name) ??
    "PiDeck";

  const chatPaneContentNode = currentSessionId ? (
    <SessionRuntimeInjector
      currentSessionId={currentSessionId}
      sessionTitle={sessionTitle}
      sessionTimeline={sessionTimeline}
      sessionActionsOpen={sessionActionsOpen}
      setSessionActionsOpen={setSessionActionsOpen}
      isLanWeb={isLanWeb}
      chatHeaderRef={chatHeaderRef}
      sessionComboRef={sessionComboRef}
      composerRef={composerRef}
      composerOffsetHeight={composerOffsetHeight}
      terminalRowHeight={terminalRowHeight}
      showToast={showToast}
      onOpenFile={openFilePath}
      onDiffFile={diffFilePath}
      onPreviewImage={setPreviewImage}
      abortAgent={abortAgent}
      restartActiveAgent={restartActiveAgent}
      runCreateSessionDraft={runCreateSessionDraft}
      enqueueSessionPrompt={enqueueSessionPrompt}
      resendUserMessage={resendUserMessage}
      editMessage={editMessage}
      deleteMessage={deleteMessage}
      agents={displayAgents}
      activeQueuedPrompts={activeQueuedPrompts}
      visibleQueuedPrompts={visibleQueuedPrompts}
      queueRetract={queue.retractQueuedPromptForEdit}
      queueDiscard={queue.discardQueuedPrompt}
      queuedTrackRef={queuedTrackRef}
      queueFlushByAgentRef={queueFlushByAgentRef}
      restartingAgentId={restartingAgentId}
      sessionDurationByAgent={sessionDurationByAgent}
      activeProjectId={activeProjectId}
      showThinking={settings.showThinking}
      validCommandNames={validCommandNames}
      validFilePaths={validFilePaths}
      terminalOpen={terminalOpen}
      terminalDockClosing={terminalDockClosing}
      terminalDockVisible={terminalDockVisible}
      terminalCollapsed={terminalCollapsed}
      availableTerminalHeight={availableTerminalHeight ?? 120}
      setTerminalOpenForAgent={setTerminalOpenForAgent}
      setTerminalCollapsedForAgent={setTerminalCollapsedForAgent}
      setTerminalHeightByAgent={setTerminalHeightByAgent}
      settingsOpen={settingsOpen}
      configOpen={configOpen}
      environmentDialog={Boolean(environmentDialog)}
      showNotice={showNotice}
      api={api}
    />
  ) : null;

  return (
    <AppShell
      listCollapsed={listCollapsed}
      listWidth={listWidth}
      listHoverRevealSuppressed={listHoverRevealSuppressed}
      drawer={drawer}
      drawerCollapsed={drawerCollapsed}
      drawerWidth={drawerWidth}
      drawerPinned={workspace.drawerPinned}
      useNativeTitleBar={settings.useNativeTitleBar}
      chatPaneRef={chatPaneRef}
      terminalRowHeight={terminalRowHeight}
      contentMaxWidth={settings.contentMaxWidth}
      sidebarContent={sidebarContentNode}
      chatPaneContent={chatPaneContentNode}
      drawerContent={(visibleDrawerPanel) => (
        <DrawerSurface
          editorMode={editorMode}
          drawer={visibleDrawerPanel}
          drawerCollapsed={drawerCollapsed}
          drawerPinned={drawerPinned}
          activeTab={activeTab}
          activeTabId={activeTabId}
          editorTabs={editorTabs}
          toggleEditorMode={toggleEditorMode}
          selectEditorTab={selectEditorTab}
          closeEditorTab={closeEditorTab}
          closeEditor={closeEditor}
          readEditorFileContent={readEditorFileContent}
          readEditorOriginalContent={readEditorOriginalContent}
          saveEditorFileContent={saveEditorFileContent}
          prevDrawerPanelRef={prevDrawerPanelRef}
          clearEditorBack={clearEditorBack}
          maxEditorFileSizeMB={settings.maxEditorFileSizeMB}
          browserFullscreen={browserFullscreen}
          enableGitManagement={settings.enableGitManagement}
          activeProjectId={activeProjectId}
          gitDrawerDiff={gitDrawerDiff}
          gitDiffDisplayMode={gitDiffDisplayMode}
          openCommitFileDiff={openCommitFileDiff}
          openWorkspaceFileDiff={openWorkspaceFileDiff}
          toggleGitDiffDisplayMode={toggleGitDiffDisplayMode}
          closeGitDiff={closeGitDiff}
          gitApi={api.git}
          gitInfo={gitInfo}
          switchBranch={switchBranch}
          createBranch={createBranch}
          onOpenDrawer={workspace.openDrawer}
          onCloseDrawer={workspace.closeDrawer}
          onCollapseDrawer={workspace.collapseDrawer}
          onToggleDrawerPin={workspace.toggleDrawerPinned}
          onCloseBrowser={() => workspace.closeBrowser()}
          onMinimizeBrowser={() => workspace.minimizeBrowser()}
          onEnterBrowserFullscreen={() => workspace.enterBrowserFullscreen()}
          sessionsProject={sessionsProject}
          sessionsProjectId={sessionsProjectId}
          files={files}
          sessions={sessions}
          sessionSourceFilter={sessionSourceFilter}
          sessionHistoryLoading={sessionHistoryLoading}
          expandedDirs={expandedDirs}
          onToggleDirectory={toggleDirectory}
          onCollapseAllDirectories={collapseAllDirectories}
          setFileMenu={setFileMenu}
          refreshFiles={refreshFiles}
          projects={projects}
          refreshProjectSessions={refreshProjectSessions}
          runOpenSidebarSession={runOpenSidebarSession}
          isSameSessionPath={isSameSessionPath}
          runCopySession={runCopySession}
          runExportHistorySession={runExportHistorySession}
          runDeleteHistorySession={runDeleteHistorySession}
          viewFilePath={viewFilePath}
          openFilePath={openFilePath}
          api={api}
          t={t}
        />
      )}
      outlineContent={hasActiveConversation ? (
<ConversationOutline
        items={outlineItems}
        onJump={sessionTimeline.jumpToMessage}
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
              workspace.closeDrawer();
            } else {
              if (activeProjectId) void refreshFiles(activeProjectId, true);
              workspace.openDrawer("files");
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
              workspace.closeDrawer();
            } else {
              workspace.openDrawer("git");
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
            const btn = (e?.currentTarget as HTMLElement)?.closest("button");
            const anchor = btn
              ? adjustMenuPos(btn.getBoundingClientRect().left - 4, btn.getBoundingClientRect().top, 220, 280)
              : undefined;
            workspace.openExternalEditorChooser(projectPath || "", anchor);
          },
          icon: <Code size={17} />,
        }}
        browserAction={{
          active: drawer === "browser",
          label: t("app.browser"),
          onClick: () => {
            if (drawer === "browser" && !drawerCollapsed) {
              workspace.closeDrawer();
            } else {
              workspace.openDrawer("browser");
            }
          },
          icon: <Globe size={17} />,
        }}
      />
    ) : null}
      setListCollapsed={setListCollapsed}
      setListWidth={setListWidth}
      setDrawerCollapsed={setDrawerCollapsed}
      setDrawerWidth={setDrawerWidth}
      onToggleListCollapsed={toggleListCollapsed}
      onReleaseListHoverSuppression={releaseListHoverSuppression}
      onDrawerCollapse={workspace.collapseDrawer}
      onDrawerClose={workspace.closeDrawer}
      onDrawerRestore={() => workspace.expandDrawer()}
      onToggleDrawerPin={workspace.toggleDrawerPinned}
      toggleAlwaysOnTop={api.app.toggleAlwaysOnTopWindow}
      minimizeWindow={api.app.minimizeWindow}
      toggleMaximizeWindow={api.app.toggleMaximizeWindow}
      closeWindow={api.app.closeWindow}
    >

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
          overlays.showConfirm({
            title: node.type === "directory" ? t("drawer.deleteFolderTitle") : t("drawer.deleteFileTitle"),
            message: node.type === "directory"
              ? t("drawer.deleteFolderConfirm", { name: node.name })
              : t("drawer.deleteFileConfirm", { name: node.name }),
            danger: true,
            confirmLabel: t("common.delete"),
            onConfirm: async () => {
              overlays.clearConfirm();
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
      agentRename={rename.renameModalsProps.agentRename}
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
        updateChecking={appUpdate.checking}
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
        onCheckUpdate={() => {
          appUpdate.check("manual").then((info) => {
            if (info && !info.hasUpdate) {
              setUpToDateVersion(info.currentVersion);
              showToast(t("app.latestVersionNotice", { version: info.currentVersion }));
            } else if (!info && appUpdate.error) {
              showToast(t("app.updateFailedNotice", { error: appUpdate.error }));
            }
          });
        }}
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
    <SessionActionOverlays {...overlays.overlayProps} />
    <AppUpdateOverlay
      controller={appUpdate}
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
    {codexImportProject && <ImportOverlayHost kind="codex" project={codexImportProject} controller={codexImportController} onClose={() => setCodexImportProject(null)} />}
    {claudeImportProject && <ImportOverlayHost kind="claude" project={claudeImportProject} controller={claudeImportController} onClose={() => setClaudeImportProject(null)} />}
    {openCodeImportProject && <ImportOverlayHost kind="opencode" project={openCodeImportProject} controller={openCodeImportController} onClose={() => setOpenCodeImportProject(null)} />}
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
    <ExternalEditorOverlay
      open={editorsOpen}
      editors={externalEditors}
      anchor={editorsAnchor}
      projectPath={editorsTargetPath}
      onClose={() => workspace.closeExternalEditorChooser()}
      onOpenProject={(editor, path) => workspace.openProjectInExternalEditor(editor)}
      onError={(error) => showToast(t("app.openEditorFailed", {error: String(error)}), 3000)}
    />

    </AppShell>
  );
}

// test
