import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import type {
	AgentUiRequest,
	AgentUiResponse,
	SessionUiResponseInput,
} from "../../../../shared/types";
import type { SessionRuntimeUiState, SessionRuntimeViewState } from "../../atoms/session-atoms";
import { t } from "../../i18n";

export type RuntimeUiBinding = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
};

type ResponseClaim = (input: SessionUiResponseInput & { request: AgentUiRequest }) => boolean;
type ResponseRollback = (input: SessionUiResponseInput & { request: AgentUiRequest }) => boolean;

export type SessionRuntimeUiResponder = {
	respond: (request: AgentUiRequest, response: AgentUiResponse) => Promise<boolean>;
};

export function createSessionRuntimeUiResponder(input: {
	binding: RuntimeUiBinding;
	readBinding: () => RuntimeUiBinding | undefined;
	claim: ResponseClaim;
	rollback: ResponseRollback;
	send: (input: SessionUiResponseInput) => Promise<void>;
	onError?: (error: unknown) => void;
}): SessionRuntimeUiResponder {
	return {
		respond: async (request, response) => {
			const start = input.readBinding();
			if (!start || !sameBinding(start, input.binding) || request.agentId !== start.agentId) return false;
			const envelope = { ...input.binding, requestId: request.requestId, response };
			if (!input.claim({ ...envelope, request })) return false;
			// Re-read immediately before IPC: a detach/rebind between render and click must win.
			const latest = input.readBinding();
			if (!latest || !sameBinding(latest, input.binding)) {
				input.rollback({ ...envelope, request });
				return false;
			}
			try {
				await input.send(envelope);
				return true;
			} catch (error) {
				input.rollback({ ...envelope, request });
				input.onError?.(error);
				return false;
			}
		},
	};
}

function sameBinding(left: RuntimeUiBinding, right: RuntimeUiBinding) {
	return left.sessionId === right.sessionId && left.agentId === right.agentId && left.runtimeGeneration === right.runtimeGeneration;
}

export type SessionRuntimeUiOverlayProps = {
	sessionId: string;
	runtime?: SessionRuntimeViewState;
	ui?: SessionRuntimeUiState;
	responder: SessionRuntimeUiResponder;
};

export function SessionRuntimeUiOverlay({ sessionId, runtime, ui, responder }: SessionRuntimeUiOverlayProps) {
	const active = runtime && ui && runtime.status !== "detached" && runtime.status !== "error" && runtime.status !== "closed" && runtime.agentId === ui.agentId && runtime.runtimeGeneration === ui.runtimeGeneration;
	const request = useMemo(() => active && ui ? Object.values(ui.requests).find((entry) => entry.status === "pending" || entry.status === "responding")?.request : undefined, [active, ui]);
	const requestState = request ? ui?.requests[request.requestId] : undefined;
	const requestKey = request ? `${sessionId}:${request.agentId}:${ui?.runtimeGeneration}:${request.requestId}` : "";
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		setValue(request?.prefill ?? (typeof request?.value === "string" ? request.value : ""));
		setBusy(false);
	}, [requestKey, request?.prefill, request?.value]);
	if (!active || !request || !requestState) return null;
	const responding = busy || requestState.status === "responding";
	const answer = async (response: AgentUiResponse) => {
		if (responding) return;
		setBusy(true);
		const accepted = await responder.respond(request, response);
		if (!accepted) setBusy(false);
	};
	const cancel = () => void answer({ cancelled: true });
	return (
		<div className="modal-backdrop ask-dialog-backdrop" onClick={cancel}>
			<section className="ask-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }} tabIndex={-1}>
				<div className="ask-dialog-header"><strong>{request.title || t("ask.defaultTitle")}</strong><button className="ask-dialog-close-btn" disabled={responding} onClick={cancel}>{t("common.close")}</button></div>
				<div className="ask-dialog-question">{request.title || t("ask.defaultTitle")}</div>
				{request.method === "select" && request.options?.length ? <div className="ask-dialog-options">{request.options.map((option, index) => <button className="ask-dialog-option" disabled={responding} key={`${request.requestId}:${option}`} onClick={() => void answer({ value: option })}><span className="ask-dialog-option-marker">{index + 1}</span><span>{option}</span></button>)}</div> : null}
				{request.method === "select" && request.allowOther ? <div className="ask-dialog-custom-input"><input className="ask-dialog-custom-field" autoFocus={!request.options?.length} value={value} placeholder={t("ask.customPlaceholder")} disabled={responding} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void answer({ value }); }} /><button className="ask-dialog-submit-btn" disabled={responding} onClick={() => void answer({ value })}>{t("ask.submit")}</button></div> : null}
				{request.method === "confirm" ? <div className="ask-dialog-options ask-dialog-options-confirm"><button className="ask-dialog-option" disabled={responding} onClick={() => void answer({ confirmed: true, value: true })}>{t("common.confirm")}</button><button className="ask-dialog-option" disabled={responding} onClick={() => void answer({ confirmed: false, value: false })}>{t("common.cancel")}</button></div> : null}
				{request.method === "input" ? <div className="ask-dialog-input-area"><input className="ask-dialog-input" autoFocus value={value} placeholder={request.placeholder || t("ask.inputPlaceholder")} disabled={responding} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void answer({ value }); }} /><button className="ask-dialog-submit-btn" disabled={responding} onClick={() => void answer({ value })}>{t("ask.submit")}</button></div> : null}
				{request.method === "editor" ? <div className="ask-dialog-input-area"><textarea className="ask-dialog-input" autoFocus value={value} placeholder={request.placeholder || t("ask.editorPlaceholder")} disabled={responding} onChange={(event) => setValue(event.target.value)} /><button className="ask-dialog-submit-btn" disabled={responding} onClick={() => void answer({ value })}>{t("ask.submit")}</button></div> : null}
				{request.method === "select" && <div className="ask-dialog-cancel-hint"><Info size={12} /><span>{t("ask.cancelHint")}</span></div>}
				{responding && <div className="ask-dialog-waiting">{t("ask.waitingForAnswer")}</div>}
			</section>
		</div>
	);
}
