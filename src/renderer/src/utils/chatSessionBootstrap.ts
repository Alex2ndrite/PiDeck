export type ChatSessionBootstrapAction =
  | { kind: "none" }
  | { kind: "load" }
  | { kind: "wait" }
  | { kind: "select"; sessionId: string };

export const CHAT_BOOTSTRAP_SESSION_ID = "renderer:chat-bootstrap";

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
