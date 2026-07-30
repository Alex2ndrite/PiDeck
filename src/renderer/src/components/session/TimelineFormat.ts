import type { ChatMessage } from "../../../../shared/types";

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function getToolStatus(
  message: ChatMessage,
): "running" | "done" | "error" {
  const status = String(message.meta?.status ?? "");
  if (status === "running") return "running";
  if (status === "error" || message.role === "error") return "error";
  return "done";
}

export function getToolName(message: ChatMessage): string {
  const fromMeta = message.meta?.toolName;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta;
  const text = stripAnsi(message.text).replace(/^[\u25b6\u2713\u2717]\s*/u, "").trim();
  return text.split(/\s+/)[0] || "tool";
}

export function getToolDetailText(message: ChatMessage): string {
  if (typeof message.meta?.detailText === "string") {
    return stripAnsi(message.meta.detailText);
  }
  return stripAnsi(JSON.stringify(message.meta ?? {}, null, 2));
}

export function getToolExitCode(message: ChatMessage): number | undefined {
  const result = message.meta?.result;
  if (!result || typeof result !== "object") return undefined;
  const value = (result as { exitCode?: unknown }).exitCode;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m${remaining}s` : `${minutes}m`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
