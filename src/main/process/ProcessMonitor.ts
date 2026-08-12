/**
 * 进程内存监控：生成 Electron 自身进程 + pi agent 子进程的内存/CPU 快照。
 *
 * 数据源说明：
 * - Electron 自身进程直接用 `app.getAppMetrics()`（Chromium 上报的 workingSetSize 等），
 *   零额外开销；pi agent 是独立子进程，不在 app metrics 里。
 * - agent 子进程内存按 pid 调系统命令采样：Windows 用 `tasklist /FI "PID eq N"`，
 *   Linux/macOS 用 `ps -o rss= -p N`。命令参数一律数组形式（禁止字符串拼接，见安全规范）。
 * - 采样失败（进程刚好退出/命令缺失）返回 undefined，快照仍可用，非致命。
 */
import { app } from "electron";
import { spawn } from "node:child_process";
import { parsePrivateMemoryBytes, parsePsRssKb, parseTasklistMemoryKb } from "./pidMemoryParsers";
import type {
  AgentProcessMetric,
  ElectronProcessMetric,
  ProcessMetricsSnapshot,
} from "../../shared/types";

const TASKLIST_TIMEOUT_MS = 2000;
const PS_TIMEOUT_MS = 2000;

/** 采集超时后 kill 子进程，避免监控调用挂死 IPC。 */
function runCollect(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`collect exited ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export { formatBytes } from "../../shared/formatBytes";

/** 按 pid 采样单个进程专用内存（字节）；失败返回 undefined。
 * 口径对齐任务管理器"内存"列（专用工作集，不含共享页）：
 * - Windows：PowerShell PrivateMemorySize64（tasklist 的 Mem Usage 是工作集，含共享页，
 *   多进程合计会把共享页重复计数——之前"内置监控 700MB vs 任务管理器 400MB"的根因）
 * - Linux/macOS：ps -o rss（无专用/共享分离，接受 RSS 口径） */
export async function sampleProcessMemoryBytes(
  pid: number,
): Promise<number | undefined> {
  try {
    if (process.platform === "win32") {
      const out = await runCollect(
        [
          "powershell",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PrivateMemorySize64`,
        ],
        TASKLIST_TIMEOUT_MS,
      );
      const bytes = parsePrivateMemoryBytes(out);
      return bytes ?? undefined;
    }
    const out = await runCollect(
      ["ps", "-o", "rss=", "-p", String(pid)],
      PS_TIMEOUT_MS,
    );
    const kb = parsePsRssKb(out);
    return kb == null ? undefined : kb * 1024;
  } catch {
    // 进程恰好退出/命令缺失都算采样失败，快照继续可用
    return undefined;
  }
}

/**
 * Electron 自身进程快照（app.getAppMetrics 直读，无系统调用）。
 * 注意：Electron MemoryInfo 的 workingSetSize/peakWorkingSetSize/privateBytes
 * 单位均为 KB（官方文档），而 ProcessMetricsSnapshot 的内存字段语义是字节，
 * 这里统一 ×1024 转换，否则与 agent 侧系统命令（已转字节）不可比，
 * 且相对任务管理器会小 1024 倍。
 * 另注意：Electron 43 的 Browser（主）进程 privateBytes 上报为 0，
 * 总量汇总时需以 privateBytes>0 为准、否则回退 workingSetSize（见 getProcessSnapshot）。
 */
export function getElectronMetrics(): ElectronProcessMetric[] {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    memoryBytes:
      metric.memory?.workingSetSize != null ? metric.memory.workingSetSize * 1024 : undefined,
    peakMemoryBytes:
      metric.memory?.peakWorkingSetSize != null
        ? metric.memory.peakWorkingSetSize * 1024
        : undefined,
    privateBytes:
      metric.memory?.privateBytes != null ? metric.memory.privateBytes * 1024 : undefined,
    cpuPercent: metric.cpu?.percentCPUUsage,
  }));
}

/**
 * 组装完整快照：Electron 进程 + agent 子进程（并发采样）+ 两组内存汇总。
 * agent 内存采样失败项不计入汇总，避免"查不到就少一块"造成总和误导。
 */
export async function getProcessSnapshot(
  agents: Array<{ agentId: string; pid: number }>,
): Promise<ProcessMetricsSnapshot> {
  const electron = getElectronMetrics();
  const sampled = await Promise.all(
    agents.map(async (agent) => {
      const memoryBytes = await sampleProcessMemoryBytes(agent.pid);
      return { ...agent, memoryBytes } as AgentProcessMetric;
    }),
  );
  const totalElectronBytes = electron.reduce(
    // 专用工作集优先（对齐任务管理器口径，不含共享页重复计数）；
    // Browser 进程 privateBytes 为 0，回退 workingSetSize，避免"查不到就少一块"。
    (sum, item) => sum + ((item.privateBytes ?? 0) > 0 ? (item.privateBytes ?? 0) : (item.memoryBytes ?? 0)),
    0,
  );
  const totalAgentBytes = sampled.reduce(
    (sum, item) => sum + (item.memoryBytes ?? 0),
    0,
  );
  return {
    electron,
    agents: sampled,
    totalElectronBytes,
    totalAgentBytes,
    sampledAt: Date.now(),
  };
}
