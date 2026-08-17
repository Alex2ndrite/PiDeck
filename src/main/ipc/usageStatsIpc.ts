/**
 * 用量统计 IPC handler（薄层：只做入参校验与适配，业务在 UsageStatsService）。
 */

import { ipcChannels } from "../../shared/ipc";
import type { UsageStatsService } from "../usageStats/UsageStatsService";
import type { OpenAiCodexQuotaService } from "../usageStats/OpenAiCodexQuotaService";

/** 校验 service 可用性：装配失败时返回结构化错误而非抛裸异常。 */
function serviceError(): never {
  throw new Error("Usage stats service is not available");
}

export function registerUsageStatsIpc(
  ipc: Electron.IpcMain,
  service: UsageStatsService | null,
  quotaService: OpenAiCodexQuotaService | null = null,
): void {
  const requireService = (): UsageStatsService => {
    if (!service) serviceError();
    return service;
  };

  ipc.handle(ipcChannels.usageStatsDetect, async () => {
    const s = requireService();
    return s.detect();
  });

  ipc.handle(ipcChannels.usageStatsRefresh, async () => {
    const s = requireService();
    return s.refresh();
  });

  ipc.handle(ipcChannels.usageStatsGet, async () => {
    const s = requireService();
    return s.getAggregated();
  });

  ipc.handle(ipcChannels.usageStatsGetCodexQuota, async (_event, options: unknown) => {
    if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) {
      throw new Error("Invalid Codex quota options");
    }
    const force = options && "force" in options ? options.force : undefined;
    if (force !== undefined && typeof force !== "boolean") throw new Error("Invalid Codex quota force option");
    if (!quotaService) return { status: "unavailable", snapshot: null, reason: "disabled" } as const;
    return quotaService.get({ force });
  });
}
