import type {
	SessionCommandError,
	SessionCommandResult,
	SessionRuntimeTarget,
} from "../../../shared/types";
import { t, type TranslationKey } from "../i18n";

const SESSION_COMMAND_ERROR_KEYS: Record<SessionCommandError["code"], TranslationKey> = {
	SESSION_NOT_FOUND: "sessionCommand.sessionNotFound",
	SESSION_RUNTIME_UNAVAILABLE: "sessionCommand.runtimeUnavailable",
	SESSION_RUNTIME_CHANGED: "sessionCommand.runtimeChanged",
	SESSION_RUNTIME_BUSY: "sessionCommand.runtimeBusy",
	SESSION_COMMAND_FAILED: "sessionCommand.commandFailed",
	SESSION_MODEL_NOT_FOUND: "sessionCommand.modelNotFound",
};

export class SessionCommandFailure extends Error {
	readonly code: SessionCommandError["code"];
	readonly params?: SessionCommandError["params"];
	readonly debugDetails?: string;
	/** 模型在本地 models.json 存在但运行中 Agent 未加载：需重启 Agent 生效。 */
	readonly needsRestart?: boolean;

	constructor(error: SessionCommandError) {
		super(t(SESSION_COMMAND_ERROR_KEYS[error.code], error.params));
		this.name = "SessionCommandFailure";
		this.code = error.code;
		this.params = error.params;
		this.debugDetails = error.debugDetails;
		this.needsRestart = error.needsRestart;
	}
}

export function requireSessionCommand<T>(result: SessionCommandResult<T>): T {
	if (result.ok) return result.value;
	throw new SessionCommandFailure(result.error);
}

export function toSessionRuntimeTarget(
	sessionId: string,
	runtime: { agentId?: string; runtimeGeneration?: number } | undefined,
): SessionRuntimeTarget | undefined {
	if (!runtime?.agentId || runtime.runtimeGeneration === undefined) return undefined;
	return {
		sessionId,
		agentId: runtime.agentId,
		runtimeGeneration: runtime.runtimeGeneration,
	};
}
