import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

/** 休息提醒间隔：1 小时（毫秒）。 */
export const WORK_BREAK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 人文关怀：由设置项 workBreakReminderEnabled 控制，开启时从本次启动开始计时，
 * 连续使用每满 1 小时弹一次休息提醒。
 * - 关闭时整个计时周期取消（卸载清理定时器）；中途重新开启则从开启时刻重新计时；
 * - 只在应用打开期间计时（renderer 存活即计时；窗口最小化时渲染进程定时器可能被节流，
 *   恰好不会在用户不看屏幕时打扰）；
 * - 每到整点（1h/2h/3h…）提示一次，文案随小时数换档（第 1 小时与后续小时用不同文案）；
 * - 组件卸载（应用退出/刷新）时清理定时器，计时随本次启动结束而重置。
 */
export function useWorkBreakReminder(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return; // 设置关闭：本周期不启动计时
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hours = 0;

    const schedule = () => {
      timer = setTimeout(() => {
        hours += 1;
        const isFirstHour = hours === 1;
        showNotice(
          isFirstHour
            ? t("app.breakReminderBodyOne")
            : t("app.breakReminderBodyMany", { hours }),
          15000,
          "info",
          isFirstHour
            ? t("app.breakReminderTitleOne")
            : t("app.breakReminderTitleMany", { hours }),
          {
            // 次按钮：仅关闭当前提醒；下一个整点仍会照常提醒
            cancel: { label: t("app.projectRemoveBlockedAck") },
          },
        );
        schedule(); // 继续排队下一个整点
      }, WORK_BREAK_INTERVAL_MS);
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
}
