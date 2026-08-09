/**
 * Runtime notify 的进程级去重。
 * 通知会暂存在 session UI 状态里，切换 Tab 后组件可能重新挂载；仅靠组件 ref
 * 会把同一条通知再次当成新事件。按 runtime generation 隔离，新的运行仍可正常提示。
 */
const seenRuntimeNotificationKeys = new Set<string>();
const MAX_SEEN_RUNTIME_NOTIFICATIONS = 200;
const seenBackgroundAskKeys = new Set<string>();

export function getRuntimeNotificationKey(
  sessionId: string,
  runtimeGeneration: number,
  requestId: string,
): string {
  return `${sessionId}:${runtimeGeneration}:${requestId}`;
}

/** 返回 true 表示这条通知是首次消费；超过上限时只保留最近一半。 */
export function rememberRuntimeNotification(key: string): boolean {
  if (seenRuntimeNotificationKeys.has(key)) return false;
  seenRuntimeNotificationKeys.add(key);
  pruneRuntimeNotificationKeys();
  return true;
}

function pruneRuntimeNotificationKeys(): void {
  if (seenRuntimeNotificationKeys.size <= MAX_SEEN_RUNTIME_NOTIFICATIONS) return;
  const retained = Array.from(seenRuntimeNotificationKeys).slice(-100);
  seenRuntimeNotificationKeys.clear();
  for (const retainedKey of retained) seenRuntimeNotificationKeys.add(retainedKey);
}

/** 后台 Ask 在焦点切换期间保持去重，只有请求结束后才显式回收。 */
export function rememberBackgroundAsk(key: string): boolean {
  if (seenBackgroundAskKeys.has(key)) return false;
  seenBackgroundAskKeys.add(key);
  if (seenBackgroundAskKeys.size > MAX_SEEN_RUNTIME_NOTIFICATIONS) {
    const retained = Array.from(seenBackgroundAskKeys).slice(-100);
    seenBackgroundAskKeys.clear();
    for (const retainedKey of retained) seenBackgroundAskKeys.add(retainedKey);
  }
  return true;
}

export function forgetBackgroundAsk(key: string): void {
  seenBackgroundAskKeys.delete(key);
}

export function getRememberedBackgroundAskKeys(): string[] {
  return Array.from(seenBackgroundAskKeys);
}
