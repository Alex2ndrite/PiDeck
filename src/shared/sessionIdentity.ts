import type { SessionEnvironment, SessionSource, SessionSummary } from "./types";

export type SessionOriginInput = {
	source: SessionSource;
	environment: SessionEnvironment;
	filePath: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
};

export function canonicalizeSessionPath(
	filePath: string,
	environment: SessionEnvironment,
): string {
	const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
	return environment === "native" ? normalized.toLowerCase() : normalized;
}

export function getSessionEnvironment(
	summary: Pick<SessionSummary, "wsl">,
): SessionEnvironment {
	return summary.wsl ? "wsl" : "native";
}

export function getImportedSessionSourceId(
	summary: Pick<SessionSummary, "source" | "codexSessionId">,
): string | undefined {
	return summary.source === "codex" ? summary.codexSessionId : undefined;
}

export function buildSessionOriginKey(input: SessionOriginInput): string {
	const environmentKey = input.environment === "wsl"
		? `wsl:${input.wslDistro ?? "unknown"}:${input.wslUser ?? "unknown"}`
		: "native";
	const importedKey = input.importedSourceId
		? `:${encodeURIComponent(input.importedSourceId)}`
		: "";
	return [
		input.source,
		environmentKey,
		canonicalizeSessionPath(input.filePath, input.environment),
	].join(":") + importedKey;
}

export function buildSummaryOriginKey(
	summary: SessionSummary,
	options?: { wslDistro?: string; wslUser?: string },
): string {
	return buildSessionOriginKey({
		source: summary.source ?? "pi",
		environment: getSessionEnvironment(summary),
		filePath: summary.filePath,
		wslDistro: options?.wslDistro,
		wslUser: options?.wslUser,
		importedSourceId: getImportedSessionSourceId(summary),
	});
}
