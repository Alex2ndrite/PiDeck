import { useCallback, useEffect, useRef, useState } from "react";

export type TurnExecutionState = {
	/** 思考/工具/中间回答步骤是否可见（run 级唯一折叠开关）。 */
	stepsVisible: boolean;
	/** 用户意图：设为指定开合态（勿用「toggle + Radix onOpenChange」以免连点/回调把状态打反）。 */
	setStepsVisibleFromUser: (open: boolean) => void;
	toggleSteps: () => void;
};

/**
 * run 级执行过程折叠状态（一个开关控制全部思考/工具/中间回答步骤）。
 *
 * 行为：
 * - agentRunning 上升沿：清 override、展开（新一轮流式实时滚出）；
 * - 流式中用户手动收起/展开：记下 override，不再被自动逻辑覆盖；
 * - agent 停转且有最终回答：1.5s 后自动收起（仅最新轮、且无 override）；
 * - 历史已完成 run 初始即折叠（有最终回答时）。
 */
export function useTurnExecution(opts: {
	agentRunning?: boolean;
	isComplete: boolean;
	/** 本轮是否存在最终回答：无最终回答的 run 不自动收起。 */
	hasFinalAnswer?: boolean;
	/** 是否时间线上最新一轮。非最新轮不自动收起、不触发对准回调。 */
	isLatestRun?: boolean;
}): TurnExecutionState & {
	/** 自动收起触发次数；TurnRow 用来在收起后对准最终回答开头。 */
	autoCollapseTick: number;
} {
	const [stepsVisible, setStepsVisible] = useState(
		() => !(opts.isComplete && !opts.agentRunning && opts.hasFinalAnswer),
	);
	const [autoCollapseTick, setAutoCollapseTick] = useState(0);
	const userOverrideRef = useRef(false);
	const wasRunningRef = useRef(Boolean(opts.agentRunning));

	// 仅在「开始跑」上升沿强制展开。若写成「只要 agentRunning 就展开」，
	// 流式中用户收起后会被 busy 抖动（tool/streaming 边沿）重新撑开。
	useEffect(() => {
		const running = Boolean(opts.agentRunning);
		if (running && !wasRunningRef.current) {
			userOverrideRef.current = false;
			setStepsVisible(true);
		}
		wasRunningRef.current = running;
	}, [opts.agentRunning]);

	// 自动收起：以「agent 已停」为准，不用 run.endedAt>0（流式中也会有时间戳）。
	useEffect(() => {
		if (opts.agentRunning || userOverrideRef.current) return;
		if (!opts.hasFinalAnswer) return;
		if (opts.isLatestRun === false) return;
		const timer = window.setTimeout(() => {
			if (userOverrideRef.current) return;
			if (opts.isLatestRun === false) {
				setStepsVisible(false);
				return;
			}
			setStepsVisible(false);
			setAutoCollapseTick((n) => n + 1);
		}, 1500);
		return () => window.clearTimeout(timer);
	}, [opts.agentRunning, opts.hasFinalAnswer, opts.isLatestRun]);

	const setStepsVisibleFromUser = useCallback((open: boolean) => {
		userOverrideRef.current = true;
		setStepsVisible(open);
	}, []);

	const toggleSteps = useCallback(() => {
		userOverrideRef.current = true;
		setStepsVisible((prev) => !prev);
	}, []);

	return { stepsVisible, setStepsVisibleFromUser, toggleSteps, autoCollapseTick };
}
