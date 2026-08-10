// 契约测试：实时 RPC 日志查看弹窗（RpcLogViewer）+ 主进程实时广播链路。
// 覆盖：
// 1) 渲染层性能红线：内存封顶 + 无筛选窗口化渲染 + 行 memo + 订阅退订；
// 2) 主进程批量节流广播（~80ms 聚合）与退出清理；
// 3) 环形缓冲扩容（初始历史）与 data 截断；
// 4) IPC 边界：get-live / save（输入校验与条数上限）/ preload 订阅。
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const viewer = readFileSync("src/renderer/src/components/sidebar/RpcLogViewer.tsx", "utf8");
const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const rpcLogger = readFileSync("src/main/logging/RpcLogger.ts", "utf8");
const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const sidebarParts = readFileSync("src/renderer/src/components/sidebar/SidebarParts.tsx", "utf8");
const sidebarContent = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
const ipc = readFileSync("src/shared/ipc.ts", "utf8");

test("viewer caps total entries and windows the unfiltered render", () => {
  assert.match(viewer, /const MAX_ENTRIES = 3000;/);
  assert.match(viewer, /const WINDOW_UNFILTERED = 800;/);
  // 无筛选时只渲染最近一段；筛选态放开到全部命中
  assert.match(viewer, /renderedEntries = hasActiveFilter\s*\? visibleEntries\s*: visibleEntries\.slice\(-WINDOW_UNFILTERED\)/);
  // 窗口化提示：条数超过窗口时告知用户可用搜索/筛选查看全部
  assert.match(viewer, /rpc\.windowHint/);
});

test("viewer rows are memoized and entry merge dedupes and caps", () => {
  assert.match(viewer, /const RpcLogRow = memo\(/);
  // mergeLogEntries：按 id 去重、时间升序、封顶 MAX_ENTRIES（内存有界）
  assert.match(viewer, /export function mergeLogEntries/);
  assert.match(viewer, /merged\.sort\(\(a, b\) => a\.time - b\.time\)/);
  assert.match(viewer, /merged\.length > MAX_ENTRIES/);
});

test("viewer uses MessageScroller auto-scroll and cleans up the live subscription", () => {
  assert.match(viewer, /<MessageScroller/);
  assert.match(viewer, /followOutput=\{autoScroll\}/);
  assert.match(viewer, /onFollowChange=\{setFollowing\}/);
  assert.match(viewer, /window\.piDesktop\.rpcLogs\.onLog/);
  // 卸载必须退订，防止向已销毁组件持续推送
  assert.match(viewer, /unsubscribe\(\);/);
  // 用户脱离实时尾部时出现回底按钮
  assert.match(viewer, /!following && entries\.length > 0/);
});

test("viewer can save the visible logs to a file", () => {
  assert.match(viewer, /window\.piDesktop\.rpcLogs\.save\(\{ agentId, entries: saveEntries \}\)/);
  // 保存语义：有筛选存筛选结果，无筛选存缓冲全量
  assert.match(viewer, /hasActiveFilter\s*\?\s*visibleEntries\.slice\(0, SAVE_ENTRY_CAP\)\s*:\s*entries\.slice\(-SAVE_ENTRY_CAP\)/);
});

test("agent context menu exposes a live log entry point next to the toggle", () => {
  const menu = readFileSync("src/renderer/src/components/sidebar/SidebarComponents.tsx", "utf8");
  assert.match(menu, /onOpenLogs\?: \(\) => void;/);
  assert.match(menu, /menu\.rpcLogView/);
  // 旧静态弹窗已从 SidebarParts 移除，不再导出
  assert.doesNotMatch(sidebarParts, /RpcLogModal/);
  assert.match(sidebarContent, /<RpcLogViewer/);
  assert.match(sidebarContent, /controller\.openRpcLogs\(menuAgent\.id\)/);
});

test("AgentManager batches live log broadcast and cleans up on exit", () => {
  // 广播只发生在开启记录的 agent 上：落盘与实时推送同一闸门
  assert.match(agentManager, /if \(this\.rpcLoggingAgents\.has\(agentId\)\) \{\n\t\t\t\t\tthis\.rpcLogger\?\.push\(logEntry\);/);
  assert.match(agentManager, /enqueueLiveRpcLog\(logEntry\)/);
  // 节流常量：~80ms 聚合一批，单批与缓冲都有上限（防止 IPC/内存失控）
  assert.match(agentManager, /LIVE_RPC_LOG_FLUSH_MS = 80/);
  assert.match(agentManager, /LIVE_RPC_LOG_MAX_BATCH = 100/);
  assert.match(agentManager, /LIVE_RPC_LOG_MAX_PENDING = 1000/);
  // 单批超限的条目留到下一轮，不丢日志
  assert.match(agentManager, /if \(rest\.length > 0\) \{\n\t+this\.pendingLiveRpcLogs\.set\(agentId, rest\);/);
  // 生命周期配对：stopAll 清定时器与聚合缓冲，agent 关闭丢弃该 agent 的待发缓冲
  assert.match(agentManager, /clearTimeout\(this\.liveRpcLogFlushTimer\)/);
  assert.match(agentManager, /dropPendingLiveRpcLogs\(agentId\)/);
});

test("RpcLogger keeps a larger live ring buffer with filtered getLive and data truncation", () => {
  assert.match(rpcLogger, /const MAX_LIVE = 1000;/);
  assert.match(rpcLogger, /getLive\(agentId\?: string\)/);
  assert.match(rpcLogger, /this\.live\.filter\(\(entry\) => entry\.agentId === agentId\)/);
  // 实时缓冲副本截断大 data，文件仍写原始内容
  assert.match(rpcLogger, /private truncateForLive\(entry: RpcLogEntry\)/);
  assert.match(rpcLogger, /this\.writeEntry\(entry\)/);
});

test("systemIpc validates save payloads and caps batch size", () => {
  assert.match(systemIpc, /rpcLogsGetLive/);
  assert.match(systemIpc, /rpcLogsSave/);
  assert.match(systemIpc, /function isRpcLogEntry\(value: unknown\)/);
  // 渲染层数据不可信：条数上限 + 字段校验后才写盘
  assert.match(systemIpc, /\.slice\(0, 10_000\)/);
  assert.match(systemIpc, /\.filter\(\(value\): value is RpcLogEntry => isRpcLogEntry\(value\)\)/);
  // 文件名 agentId 脱敏，防止路径注入（源码里 replace 的参数是正则字面量，前面带 /）
  assert.match(systemIpc, /agentId\.replace\(\/\[\^\\w-.~\]/);
});

test("preload exposes getLive/save/onLog with unsubscribe", () => {
  assert.match(preload, /rpcLogsGetLive/);
  assert.match(preload, /rpcLogsSave/);
  assert.match(preload, /onLog: \(callback: \(batch: RpcLogBatch\) => void\) =>/);
  assert.match(ipc, /rpcLogsGetLive: "rpc-logs:get-live"/);
  assert.match(ipc, /rpcLogsSave: "rpc-logs:save"/);
});
