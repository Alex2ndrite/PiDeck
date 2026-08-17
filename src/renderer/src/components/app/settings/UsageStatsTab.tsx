/**
 * 用量统计设置页 Tab。
 *
 * 数据源：pi-tracker 扩展日志（主进程聚合后整体下发，渲染层不接触原始日志）。
 * 状态由未安装、加载、失败和数据视图组成；数据视图保留刷新失败前的旧快照。
 * 图表为自绘 SVG（UsageHeatmap / UsageDailyChart），不引入图表库。
 */

import { useCallback, useEffect, useState } from "react";
import type {
  UsageAggregated,
  UsageStatsDetectResult,
} from "../../../../../shared/types";
import { UsageDashboardSection } from "../usageStats/UsageDashboardSection";
import { useOpenAiCodexQuota } from "../../../hooks/useOpenAiCodexQuota";

type Phase = "loading" | "missing" | "ready" | "error";

export function UsageStatsTab() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<UsageAggregated | null>(null);
  const [detect, setDetect] = useState<UsageStatsDetectResult | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { result: quotaResult, loading: quotaLoading, load: loadQuota, refresh: refreshQuota } = useOpenAiCodexQuota();

  /** 扩展列表只是辅助探测；usage.jsonl 仍是主进程用量链路的权威数据源。 */
  const probePluginInstalled = useCallback(async (): Promise<boolean | null> => {
    try {
      const list = await window.piDesktop.extensions.list();
      const found = list.extensions.some((ext) => {
        const source = ext.source ?? "";
        const id = ext.id ?? "";
        return id === "pi-tracker" || source.includes("pi-tracker");
      });
      return found;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const detectResult = await window.piDesktop.usageStats.detect();
      setDetect(detectResult);
      const installed = await probePluginInstalled();
      if (!detectResult.installed && installed === false) {
        // 无日志且未安装 → 引导安装
        setData(null);
        setPhase("missing");
        return;
      }
      const aggregated = await window.piDesktop.usageStats.get();
      if (!aggregated) {
        setData(null);
        setPhase(detectResult.installed || installed === true ? "ready" : "missing");
        return;
      }
      setData(aggregated);
      setError("");
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [probePluginInstalled]);

  useEffect(() => {
    void Promise.all([load(), loadQuota()]);
  }, [load, loadQuota]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([window.piDesktop.usageStats.refresh(), refreshQuota()]);
      const aggregated = await window.piDesktop.usageStats.get();
      const detectResult = await window.piDesktop.usageStats.detect();
      setDetect(detectResult);
      const installedNow = await probePluginInstalled();
      if (!aggregated) {
        // 刷新成功但权威数据源已消失时，不能继续展示上一次的旧快照。
        setData(null);
        setPhase(detectResult.installed || installedNow === true ? "ready" : "missing");
      } else {
        setData(aggregated);
        setPhase(aggregated.recordCount > 0 || detectResult.installed || installedNow === true ? "ready" : "missing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 保留旧数据；视图会在原仪表盘上给出可恢复的错误提示。
      setPhase((previous) => (data ? "ready" : previous === "missing" ? "missing" : "error"));
    } finally {
      setRefreshing(false);
    }
  }, [data, probePluginInstalled, refreshQuota]);

  return <UsageDashboardSection phase={phase} data={data} detect={detect} error={error} refreshing={refreshing} onRefresh={refresh} quotaResult={quotaResult} quotaLoading={quotaLoading} />;
}
