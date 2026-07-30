import type {
	SessionCommandError,
	SessionCommandErrorCode,
} from "../../shared/types";
import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";

type SessionCommandCopyKey = Extract<MainProcessTranslationKey,
	| "sessionCommand.sessionNotFound"
	| "sessionCommand.runtimeUnavailable"
	| "sessionCommand.runtimeChanged"
	| "sessionCommand.runtimeBusy"
	| "sessionCommand.commandFailed"
>;

type SessionCommandCopy = (
	key: SessionCommandCopyKey,
	params?: Record<string, string | number>,
) => string;

const SESSION_COMMAND_COPY_KEYS: Record<SessionCommandErrorCode, SessionCommandCopyKey> = {
	SESSION_NOT_FOUND: "sessionCommand.sessionNotFound",
	SESSION_RUNTIME_UNAVAILABLE: "sessionCommand.runtimeUnavailable",
	SESSION_RUNTIME_CHANGED: "sessionCommand.runtimeChanged",
	SESSION_RUNTIME_BUSY: "sessionCommand.runtimeBusy",
	SESSION_COMMAND_FAILED: "sessionCommand.commandFailed",
};

/** IPC exposes only the stable message; diagnostics remain available for local logging. */
export class SessionCommandIpcError extends Error {
	readonly code: SessionCommandErrorCode;
	readonly params?: Record<string, string | number>;
	readonly debugDetails?: string;

	constructor(error: SessionCommandError, translate: SessionCommandCopy) {
		super(translate(SESSION_COMMAND_COPY_KEYS[error.code], error.params));
		this.name = "SessionCommandIpcError";
		this.code = error.code;
		this.params = error.params;
		this.debugDetails = error.debugDetails;
	}
}
