import { useAtom, useAtomValue } from "jotai";
import { useCallback, useRef } from "react";
import type { OpenAiCodexQuotaResult } from "../../../shared/types";
import { desktopApi } from "../desktopApi";
import { openAiCodexQuotaLoadingAtom, openAiCodexQuotaResultAtom } from "../atoms/openAiCodexQuotaAtoms";

/** 账户级配额的唯一渲染层 owner；调用方决定何时 load，避免所有 Composer 主动请求。 */
export function useOpenAiCodexQuota() {
	const result = useAtomValue(openAiCodexQuotaResultAtom);
	const [loading, setLoading] = useAtom(openAiCodexQuotaLoadingAtom);
	const [, setResult] = useAtom(openAiCodexQuotaResultAtom);
	const inFlight = useRef<Promise<OpenAiCodexQuotaResult> | null>(null);
	const resultRef = useRef(result);
	resultRef.current = result;

	const load = useCallback(async (force = false): Promise<OpenAiCodexQuotaResult> => {
		if (inFlight.current) return inFlight.current;
		setLoading(true);
		const request = desktopApi.usageStats.getCodexQuota({ force }).then((next) => {
			setResult(next);
			return next;
		}).catch(() => {
			// IPC transport failures are outside the quota service's stale fallback. Preserve an
			// existing account snapshot instead of turning a transient bridge failure into 0/empty.
			const previous = resultRef.current;
			const fallback: OpenAiCodexQuotaResult = previous?.status === "ready" || previous?.status === "stale"
				? { status: "stale", snapshot: previous.snapshot, reason: "network" }
				: { status: "unavailable", snapshot: null, reason: "network" };
			setResult(fallback);
			return fallback;
		}).finally(() => {
			inFlight.current = null;
			setLoading(false);
		});
		inFlight.current = request;
		return request;
	}, [setLoading, setResult]);

	const refresh = useCallback(() => load(true), [load]);
	return { result, loading, load, refresh };
}
