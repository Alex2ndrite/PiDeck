import { useEffect, useMemo, useState } from "react";
import { MessageCircle, X } from "lucide-react";
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
		<div className="ask-inline-bar">
			<div className="ask-inline-bar-header">
				<MessageCircle size={14} />
				<span>{t("ask.toolName")}</span>
				{request.method === "select" && request.options?.length ? (
					<span className="ask-inline-bar-cancel-hint">{t("ask.cancelHint")}</span>
				) : null}
				<button
					className="ask-inline-bar-close"
					title={t("common.close")}
					aria-label={t("common.close")}
					disabled={responding}
					onClick={cancel}
				>
					<X size={14} />
				</button>
			</div>
			<div className="ask-inline-bar-question">{request.title || t("ask.defaultTitle")}</div>
			<div className="ask-inline-bar-body">
				{request.method === "select" && request.options?.length ? (
					<div className="ask-inline-bar-options">
						{request.options.map((option) => (
							<button
								className="ask-inline-bar-option"
								disabled={responding}
								key={`${request.requestId}:${option}`}
								onClick={() => void answer({ value: option })}
							>
								<span className="ask-inline-bar-option-marker">{option}</span>
							</button>
						))}
						{request.allowOther ? (
							<div className="ask-inline-bar-custom-input">
								<input
									className="ask-inline-bar-custom-field"
									autoFocus={false}
									value={value}
									placeholder={t("ask.customPlaceholder")}
									disabled={responding}
									onChange={(event) => setValue(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") void answer({ value });
									}}
								/>
								<button className="ask-inline-bar-submit-btn" disabled={responding} onClick={() => void answer({ value })}>
									{t("ask.submit")}
								</button>
							</div>
						) : null}
					</div>
				) : null}
				{request.method === "confirm" ? (
					<div className="ask-inline-bar-options ask-inline-bar-options-confirm">
						<button className="ask-inline-bar-option ask-inline-bar-option-yes" disabled={responding} onClick={() => void answer({ confirmed: true, value: true })}>{t("common.confirm")}</button>
						<button className="ask-inline-bar-option ask-inline-bar-option-no" disabled={responding} onClick={() => void answer({ confirmed: false, value: false })}>{t("common.cancel")}</button>
					</div>
				) : null}
				{request.method === "input" ? (
					<div className="ask-inline-bar-input-area">
						<input className="ask-inline-bar-input" autoFocus value={value} placeholder={request.placeholder || t("ask.inputPlaceholder")} disabled={responding} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void answer({ value }); }} />
						<button className="ask-inline-bar-submit-btn" disabled={responding} onClick={() => void answer({ value })}>{t("ask.submit")}</button>
					</div>
				) : null}
				{request.method === "editor" ? (
					<div className="ask-inline-bar-input-area">
						<textarea className="ask-inline-bar-input" autoFocus value={value} placeholder={request.placeholder || t("ask.editorPlaceholder")} disabled={responding} onChange={(event) => setValue(event.target.value)} />
						<button className="ask-inline-bar-submit-btn" disabled={responding} onClick={() => void answer({ value })}>{t("ask.submit")}</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
