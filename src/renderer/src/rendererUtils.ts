import type {
  Project,
  SessionSummary,
  SessionEnvironment,
  AgentTab,
} from "../../shared/types";
import { isSameSessionPath } from "./agentListDisplay";

// ask 内容（问答 + 底部输入框）需要比纯输入框更大的可视空间；面板仍可沿分隔条拖拽。
// 375=默认高度（尽可能一次看到问答与输入框），175=面板最小/最小时高度底线。
export const COMPOSER_DEFAULT_HEIGHT = 375;
const COMPOSER_MIN_HEIGHT = 175;
export { COMPOSER_MIN_HEIGHT };

// Ask 区域垂直 resize 手把的约束（AskRegionResizer 使用）：
// 220=展开时默认高度上限，96=收窄下限，420=可在面板内拉高的最大值，
// 16=键盘步进（PageUp/PageDown 为 4 倍）。上限不会强迫留白：Ask 折叠时只显示实际内容。
export const ASK_DEFAULT_MAX_HEIGHT = 220;
export const ASK_MIN_HEIGHT = 96;
export const ASK_MAX_HEIGHT = 420;
export const ASK_STEP_PX = 16;

export function displayProjectDirectoryName(project: Project) {
  if (isChatProject(project)) return "Chat";
  const normalizedPath = project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.split("/").pop() || project.name || project.path;
}

export function isChatProject(project?: Project) {
  return project?.kind === "chat";
}

export function formatCodexSubagentName(session: SessionSummary) {
  const label = [session.codexAgentNickname, session.codexAgentRole]
    .filter(Boolean)
    .join(" · ");
  return label || session.name || "Codex Subagent";
}

/** pi 原生子会话名称：优先使用会话名，回退到 "子会话" */
export function formatPiSubagentName(session: SessionSummary) {
  return session.name || "Pi Subagent";
}

/** 从 localStorage 恢复会话来源过滤配置 */
export function loadSessionSourceFilter(): Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null> {
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
export function saveSessionSourceFilter(filter: Record<string, Set<"pi" | "codex" | "claude" | "opencode"> | null>) {
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

export function inferSessionEnvironment(filePath?: string): SessionEnvironment {
  return filePath?.startsWith("/") ? "wsl" : "native";
}

export type PendingAgentTab = AgentTab & {
  pendingKind?: "create" | "restart";
  pendingStartedAt?: number;
};

export function isReplacementForPendingAgent(agent: AgentTab, pending: PendingAgentTab) {
  if (agent.projectId !== pending.projectId || agent.cwd !== pending.cwd)
    return false;

  const environment = inferSessionEnvironment(pending.sessionPath);
  if (pending.pendingKind === "restart") {
    const startedAt = pending.pendingStartedAt ?? pending.createdAt;
    // 重启占位只匹配本次重启之后出现的新进程，避免误选同项目下已有的同名 Agent。
    if (agent.createdAt < startedAt - 1000) return false;
    if (isSameSessionPath(agent.sessionPath, pending.sessionPath)) return true;
    return !pending.sessionPath && agent.title === pending.title;
  }

  if (!pending.id.startsWith("pending-")) return false;
  if (isSameSessionPath(agent.sessionPath, pending.sessionPath)) return true;
  if (pending.sessionPath && agent.createdAt >= pending.createdAt - 1000)
    return true;
  return (
    agent.title === pending.title && agent.createdAt >= pending.createdAt - 1000
  );
}

export function isPendingAgentId(agentId?: string) {
  return Boolean(agentId?.startsWith("pending-"));
}

export function migrateAgentRecord<T>(
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
