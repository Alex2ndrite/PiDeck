import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DelegationPreflightInput,
	DelegationPreflightReport,
	DelegationRole,
	DelegationWorkspaceMode,
} from "../../../shared/types";
import { desktopApi } from "../desktopApi";

/** 预检节流：角色/模型/工作区切换往往连续发生，避免每次点击都 fork 一次 pi --list-models。 */
const PREFLIGHT_DEBOUNCE_MS = 250;

export type DelegationPreflightState = {
	report: DelegationPreflightReport | undefined;
	loading: boolean;
	failed: boolean;
	refresh: () => void;
};

/**
 * Spawn 前预检的渲染层 owner：按当前委托表单形态查询主进程预检结果。
 *
 * 约定：
 * - 只在对话框打开且 parent 已确定时查询；关闭即清空，避免复用上一次会话的结论；
 * - 序号守卫丢弃迟到响应（模型下拉快速切换时旧结果不得覆盖新结果）；
 * - 查询失败与「预检不通过」区分开：failed 表示预检本身没跑成功，交由 UI 提示重试。
 */
export function useDelegationPreflight(options: {
	enabled: boolean;
	parentSessionId: string | undefined;
	role: DelegationRole;
	model: { provider: string; modelId: string } | undefined;
	workspaceMode: DelegationWorkspaceMode;
}): DelegationPreflightState {
	const { enabled, parentSessionId, role, workspaceMode } = options;
	const provider = options.model?.provider;
	const modelId = options.model?.modelId;
	const [report, setReport] = useState<DelegationPreflightReport | undefined>();
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);
	const [manualToken, setManualToken] = useState(0);

	const refresh = useCallback(() => setManualToken((token) => token + 1), []);

	useEffect(() => {
		if (!enabled || !parentSessionId) {
			sequence.current += 1;
			setReport(undefined);
			setLoading(false);
			setFailed(false);
			return;
		}
		const input: DelegationPreflightInput = {
			parentSessionId,
			role,
			model: provider && modelId ? { provider, modelId } : undefined,
			workspaceMode,
		};
		const current = ++sequence.current;
		setLoading(true);
		setFailed(false);
		const timer = setTimeout(() => {
			void desktopApi.delegations.preflight(input).then((next) => {
				if (current !== sequence.current) return;
				setReport(next);
			}).catch(() => {
				if (current !== sequence.current) return;
				setReport(undefined);
				setFailed(true);
			}).finally(() => {
				if (current === sequence.current) setLoading(false);
			});
		}, PREFLIGHT_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			// 卸载/入参变化时作废本轮结果，防止旧响应写进新表单状态。
			sequence.current += 1;
		};
	}, [enabled, parentSessionId, role, provider, modelId, workspaceMode, manualToken]);

	return { report, loading, failed, refresh };
}
