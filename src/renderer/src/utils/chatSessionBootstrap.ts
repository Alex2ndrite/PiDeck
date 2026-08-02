export type ChatSessionBootstrapAction =
  | { kind: "none" }
  | { kind: "load" }
  | { kind: "wait" }
  | { kind: "select"; sessionId: string };

export const CHAT_BOOTSTRAP_SESSION_ID = "renderer:chat-bootstrap";

/** 欢迎页（未启动 Agent）选择的模型偏好存储 key。 */
export const WELCOME_MODEL_KEY = "pideck:welcome-model";
/** 欢迎页（未启动 Agent）选择的思考级别偏好存储 key。 */
export const WELCOME_THINKING_KEY = "pideck:welcome-thinking";

/** 读取欢迎页最后选择的模型偏好（无则 undefined）。 */
export function readWelcomeModelPreference(): {
  model: { provider: string; modelId: string };
} | undefined {
  try {
    const raw = localStorage.getItem(WELCOME_MODEL_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { provider?: string; modelId?: string };
    if (typeof parsed.provider === "string" && typeof parsed.modelId === "string") {
      return { model: { provider: parsed.provider, modelId: parsed.modelId } };
    }
  } catch {
    // 解析失败视为无偏好
  }
  return undefined;
}

/** 读取欢迎页最后选择的思考级别（无则 undefined）。 */
export function readWelcomeThinkingPreference(): { thinkingLevel: string } | undefined {
  try {
    const level = localStorage.getItem(WELCOME_THINKING_KEY);
    if (level) return { thinkingLevel: level };
  } catch {
    // 读取失败视为无偏好
  }
  return undefined;
}

/**
 * The built-in Chat view needs an identity before the composer renders, but
 * opening the app must not add an unrequested row to history. This renderer-
 * only ID is promoted to a Catalog record only when the user sends.
 */
export function resolveChatSessionBootstrap(input: {
  isChatProject: boolean;
  currentSessionId?: string;
  catalogStatus?: "idle" | "loading" | "ready" | "error";
}): ChatSessionBootstrapAction {
  if (!input.isChatProject || input.currentSessionId) return { kind: "none" };
  // The Chat project can remain collapsed in the sidebar, so it cannot rely on
  // the normal expanded-project scan to reach `ready`. Loading its empty catalog
  // gives the renderer-only surface a deterministic point to appear without
  // creating a durable history entry or starting pi.
  if (input.catalogStatus === "idle" || input.catalogStatus === "error" || !input.catalogStatus) {
    return { kind: "load" };
  }
  if (input.catalogStatus !== "ready") return { kind: "wait" };
  return { kind: "select", sessionId: CHAT_BOOTSTRAP_SESSION_ID };
}
