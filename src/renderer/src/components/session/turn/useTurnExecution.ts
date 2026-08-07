import { useCallback, useEffect, useRef, useState } from "react";

export type TurnExecutionState = {
	/** 思考/工具/中间回答步骤是否可见（run 级唯一折叠开关）。 */
	stepsVisible: boolean;
	toggleSteps: () => void;
};

/**
 * run 级执行过程折叠状态（一个开关控制全部思考/工具/中间回答步骤）。
 *
 * 行为（与用户确认）：
 * - run 生命周期内（agentRunning）保持展开：流式期间思考/工具/中间回答实时滚出；
 * - run 结束（isComplete）后 1s 自动收起（仅一次；用户手动操作后不再被自动覆盖）；
 * - 历史已完成 run 初始即折叠（加载旧会话默认收起，不弹开）。
 */
export function useTurnExecution(opts: {
	agentRunning?: boolean;
	isComplete: boolean;
	/** 本轮是否存在最终回答：无最终回答的 run（中断/异常/只出中间回答）
	 *  不自动收起，保持内容可见——折叠后没有最终回答兜底，用户会看不到任何输出。 */
	hasFinalAnswer?: boolean;
}): TurnExecutionState {
	// 已完成的 run 默认折叠（有最终回答时）；无最终回答或进行中默认展开。
	const [stepsVisible, setStepsVisible] = useState(
		() => !(opts.isComplete && !opts.agentRunning && opts.hasFinalAnswer),
	);
	// 用户手动 toggle 后本轮不再被自动逻辑覆盖。
	const userOverrideRef = useRef(false);

	// run 开始：清掉上一轮 override，恢复自动展开（流式实时滚出）。
	useEffect(() => {
		if (!opts.agentRunning) return;
		userOverrideRef.current = false;
		setStepsVisible(true);
	}, [opts.agentRunning]);

	// run 结束：1s 后自动收起（用户未 override 且有最终回答时；无最终回答保持展开）。
	useEffect(() => {
		if (!opts.isComplete || userOverrideRef.current) return;
		if (!opts.hasFinalAnswer) return;
		const timer = window.setTimeout(() => {
			if (userOverrideRef.current) return;
			setStepsVisible(false);
		}, 1000);
		return () => window.clearTimeout(timer);
	}, [opts.isComplete, opts.hasFinalAnswer]);

	const toggleSteps = useCallback(() => {
		userOverrideRef.current = true;
		setStepsVisible((prev) => !prev);
	}, []);

	return { stepsVisible, toggleSteps };
}
