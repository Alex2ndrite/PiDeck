import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

/** 休息提醒间隔：2 小时（毫秒）。 */
export const WORK_BREAK_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * 本次应用启动内的静音标记：点「本次启动不再提醒」后置位，
 * 之后本启动内不再弹提醒；模块级变量随应用进程存活，重启自动复位。
 */
let mutedForSession = false;

/**
 * 人文关怀：由设置项 workBreakReminderEnabled 控制，开启时从本次启动开始计时，
 * 连续使用每满 2 小时弹一次休息提醒。
 * - 关闭时整个计时周期取消（effect 重跑清理定时器）；中途重新开启则从开启时刻重新计时；
 * - 弹框提供两个操作：
 *   1) 主按钮「本次启动不再提醒」：本应用启动内静音（重启后恢复），适合临时不想被打扰；
 *   2) 次按钮「永久不再提醒」：通过 onPermanentlyDisable 写回设置永久关闭，可在设置中重新开启；
 *   直接关闭弹框或等它自动消失 = 只关当前这条，下一个 2 小时周期照常提醒；
 * - 只在应用打开期间计时（renderer 存活即计时；窗口最小化时渲染进程定时器可能被节流，
 *   恰好不会在用户不看屏幕时打扰）；
 * - 每到周期（2h/4h/6h…）提示一次，文案随周期数换档（首次与后续用不同文案）；
 * - 组件卸载（应用退出/刷新）时清理定时器，计时随本次启动结束而重置。
 */
export function useWorkBreakReminder(
	enabled: boolean,
	onPermanentlyDisable?: () => void,
): void {
	// 用 ref 持有永久关闭回调：回调引用变化不应重启 2 小时计时周期
	const onPermanentlyDisableRef = useRef(onPermanentlyDisable);
	onPermanentlyDisableRef.current = onPermanentlyDisable;

	useEffect(() => {
		if (!enabled) return; // 设置关闭：本周期不启动计时
		if (mutedForSession) return; // 本启动内已静音：不再计时
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cycles = 0;

		const schedule = () => {
			timer = setTimeout(() => {
				if (mutedForSession) return; // 静音后不再弹，也不再排队下一个周期
				cycles += 1;
				const isFirstCycle = cycles === 1;
				showNotice(
					isFirstCycle
						? t("app.breakReminderBodyOne")
						: t("app.breakReminderBodyMany", { hours: cycles * 2 }),
					15000,
					"info",
					isFirstCycle
						? t("app.breakReminderTitleOne")
						: t("app.breakReminderTitleMany", { hours: cycles * 2 }),
					{
						// 主按钮：本次启动不再提醒（重启后恢复提醒）
						action: {
							label: t("app.breakReminderMuteSession"),
							onClick: () => {
								mutedForSession = true;
							},
						},
						// 次按钮：永久关闭提醒（设置中可重新开启）
						cancel: {
							label: t("app.breakReminderDisableForever"),
							onClick: () => onPermanentlyDisableRef.current?.(),
						},
					},
				);
				schedule(); // 继续排队下一个整点
			}, WORK_BREAK_INTERVAL_MS);
		};
		schedule();
		return () => {
			if (timer !== undefined) clearTimeout(timer);
		};
	}, [enabled]);
}
