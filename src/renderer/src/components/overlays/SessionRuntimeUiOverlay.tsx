import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, MessageCircle, X } from "lucide-react";
import type {
	AgentUiBatchQuestion,
	AgentUiRequest,
	AgentUiResponse,
	SessionUiResponseInput,
} from "../../../../shared/types";
import type { SessionRuntimeUiState, SessionRuntimeViewState } from "../../atoms/session-atoms";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";

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

type BatchAnswer = string | boolean | undefined;

function batchAnswerLabel(value: BatchAnswer): string {
	if (typeof value === "boolean") return value ? t("common.true") : t("common.false");
	return value ?? "";
}

function BatchAskInlineBar(props: {
	request: AgentUiRequest;
	responding: boolean;
	onCancel: () => void;
	onSubmit: (answers: string) => void;
}) {
	const questions = props.request.batchQuestions ?? [];
	const total = questions.length;
	const [answers, setAnswers] = useState<Record<string, BatchAnswer>>({});
	const [answerLabels, setAnswerLabels] = useState<Record<string, string>>({});
	const [customAnswerIds, setCustomAnswerIds] = useState<Set<string>>(new Set());
	const [inputValues, setInputValues] = useState<Record<string, string>>({});
	const [currentTab, setCurrentTab] = useState(0);
	const requestKey = props.request.requestId;

	useEffect(() => {
		setAnswers({});
		setAnswerLabels({});
		setCustomAnswerIds(new Set());
		setInputValues(
			Object.fromEntries(
				questions
					.filter((question) => question.prefill)
					.map((question) => [question.id, question.prefill ?? ""]),
			),
		);
		setCurrentTab(0);
	}, [requestKey]);

	const answeredCount = questions.filter((question) => answers[question.id] !== undefined).length;
	const allAnswered = total > 0 && answeredCount === total;
	const reviewTab = props.request.batchReview === true && currentTab === total;
	const currentQuestion = reviewTab ? undefined : questions[currentTab];
	const finalStep = currentTab === total - 1;

	function setAnswer(questionId: string, value: BatchAnswer, label = batchAnswerLabel(value), wasCustom = false) {
		setAnswers((current) => ({ ...current, [questionId]: value }));
		setAnswerLabels((current) => ({ ...current, [questionId]: label }));
		setCustomAnswerIds((current) => {
			const next = new Set(current);
			if (wasCustom) next.add(questionId);
			else next.delete(questionId);
			return next;
		});
	}

	function submitText(question: AgentUiBatchQuestion) {
		const value = inputValues[question.id]?.trim();
		if (value) setAnswer(question.id, value, value, question.type === "select");
	}

	function submitAnswers() {
		const result = questions.map((question) => {
			const value = answers[question.id];
			return {
				id: question.id,
				type: question.type,
				value: value ?? null,
				label: answerLabels[question.id] ?? batchAnswerLabel(value),
				wasCustom: customAnswerIds.has(question.id),
			};
		});
		props.onSubmit(JSON.stringify({ answers: result }));
	}

	if (total === 0) return null;

	return (
		<div className="ask-inline-bar rounded-t-md border border-b-0 border-border-strong bg-[color:color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-panel))] p-3 max-h-[55vh] overflow-y-auto">
			<div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
				<MessageCircle size={14} aria-hidden="true" />
				<span>{t("ask.batchTitle", { count: total })}</span>
				<span className="ml-auto text-[11px] font-normal text-text-tertiary">
					{t("ask.batchProgress", { done: answeredCount, total })}
				</span>
				<Button variant="ghost" size="icon"
										aria-label={t("common.close")} title={t("common.close")}
					disabled={props.responding}
					onClick={props.onCancel}
				>
					<X size={14} aria-hidden="true" />
				</Button>
			</div>

			<div className="mb-2 flex gap-1 overflow-x-auto border-b border-border-subtle pb-2" role="tablist">
				{questions.map((question, index) => {
					const answered = answers[question.id] !== undefined;
					const active = index === currentTab;
					return (
						<Button
							key={question.id}
							variant="ghost"
							role="tab"
							aria-selected={active}
							className={`ask-batch-tab inline-flex h-[26px] flex-none items-center gap-1 rounded-md border border-border-subtle bg-transparent px-2 font-sans text-[11px] whitespace-nowrap text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55${active ? " active" : ""}${answered ? " answered" : ""}`}
							disabled={props.responding}
							onClick={() => setCurrentTab(index)}
						>
							<span className="min-w-[14px] text-center font-mono font-semibold">{index + 1}</span>
							<span className="max-w-[14ch] truncate">{question.question}</span>
							{answered ? <Check size={11} className="shrink-0 text-[var(--color-success)]" aria-hidden="true" /> : null}
						</Button>
					);
				})}
				{props.request.batchReview ? (
					<Button
						variant="ghost"
						role="tab"
						aria-selected={reviewTab}
						className={`ask-batch-tab ask-batch-tab--review border-[var(--color-warning)] text-[var(--color-warning)] inline-flex h-[26px] flex-none items-center gap-1 rounded-md px-2 font-sans text-[11px] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55${reviewTab ? " active" : ""}`}
						disabled={props.responding}
						onClick={() => setCurrentTab(total)}
					>
						<ClipboardList size={12} aria-hidden="true" />
						<span className="ask-batch-tab-label">{t("ask.batchReviewTab")}</span>
					</Button>
				) : null}
			</div>

			<div>
				{reviewTab ? (
					<div className="flex flex-col gap-2">
						<div className="inline-flex items-center gap-1 text-sm font-semibold text-text-primary">
							<ClipboardList size={16} aria-hidden="true" />
							<span>{t("ask.batchReviewTitle")}</span>
						</div>
						<div className="text-xs text-text-tertiary">{t("ask.batchReviewHint")}</div>
						<div className="flex max-h-[240px] flex-col gap-1 overflow-y-auto rounded-sm bg-bg-muted p-2">
							{questions.map((question, index) => {
								const value = answers[question.id];
								const answered = value !== undefined;
								return (
									<div key={question.id} className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,30ch)] items-start gap-2 text-xs leading-[1.6] text-text-primary">
										<span className="font-mono font-semibold">{index + 1}</span>
										<span className="min-w-0 [overflow-wrap:anywhere]">{question.question}</span>
										<span className={`min-w-0 text-right font-mono font-medium [overflow-wrap:anywhere]${answered ? " answered" : " unanswered"}`}>
											{answered ? answerLabels[question.id] ?? batchAnswerLabel(value) : "-"}
										</span>
									</div>
								);
							})}
						</div>
						{!allAnswered ? (
							<div className="rounded-sm bg-[color:color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-2 text-xs text-[var(--color-warning)]">{t("ask.batchIncomplete")}</div>
						) : null}
						<Button
														variant="default"
							disabled={!allAnswered || props.responding}
							onClick={submitAnswers}
						>
							{t("ask.batchSubmitAll")}
						</Button>
					</div>
				) : currentQuestion ? (
					<BatchQuestion
						question={currentQuestion}
						questionIndex={currentTab}
						total={total}
						answer={answers[currentQuestion.id]}
						inputValue={inputValues[currentQuestion.id] ?? ""}
						responding={props.responding}
						onAnswer={(value, label, wasCustom) => setAnswer(currentQuestion.id, value, label, wasCustom)}
						onInputChange={(value) => setInputValues((current) => ({ ...current, [currentQuestion.id]: value }))}
						onSubmitInput={() => submitText(currentQuestion)}
						onPrevious={currentTab > 0 ? () => setCurrentTab(currentTab - 1) : undefined}
						onNext={() => {
							if (!finalStep) {
								setCurrentTab(currentTab + 1);
							} else if (props.request.batchReview) {
								setCurrentTab(total);
							} else {
								submitAnswers();
							}
						}}
						nextDisabled={finalStep && !props.request.batchReview && !allAnswered}
						finalLabel={finalStep && !props.request.batchReview ? t("ask.batchSubmitAll") : undefined}
					/>
				) : null}
			</div>
		</div>
	);
}

function BatchQuestion(props: {
	question: AgentUiBatchQuestion;
	questionIndex: number;
	total: number;
	answer: BatchAnswer;
	inputValue: string;
	responding: boolean;
	onAnswer: (value: BatchAnswer, label?: string, wasCustom?: boolean) => void;
	onInputChange: (value: string) => void;
	onSubmitInput: () => void;
	onPrevious?: () => void;
	onNext: () => void;
	nextDisabled: boolean;
	finalLabel?: string;
}) {
	const { question } = props;
	return (
		<div className="flex flex-col gap-2">
			<div className="font-mono text-xs font-semibold text-text-tertiary">
				{t("common.details")} {props.questionIndex + 1}/{props.total}
			</div>
			<div className="mb-3 text-sm font-medium leading-[1.6] break-words text-text-primary">{question.question}</div>
			<div className="ask-batch-question-body">
				{question.type === "confirm" ? (
					<div className="flex gap-2">
						<Button
							className={`ask-inline-bar-option ask-inline-bar-option-yes flex-none items-center justify-center whitespace-nowrap${props.answer === true ? " selected" : ""}`}
							variant="ghost"
							disabled={props.responding}
							onClick={() => props.onAnswer(true, t("common.true"))}
						>
							{t("common.true")}
						</Button>
						<Button
							className={`ask-inline-bar-option ask-inline-bar-option-no flex-none items-center justify-center whitespace-nowrap${props.answer === false ? " selected" : ""}`}
							variant="ghost"
							disabled={props.responding}
							onClick={() => props.onAnswer(false, t("common.false"))}
						>
							{t("common.false")}
						</Button>
					</div>
				) : question.type === "select" && question.options?.length ? (
					<>
						<div className="flex max-h-[180px] flex-wrap gap-2 overflow-y-auto pr-1">
							{question.options.map((option, index) => {
								const label = typeof option === "string" ? option : option.label;
								const value = typeof option === "string" ? option : option.value ?? label;
								const description = typeof option === "string" ? undefined : option.description;
								return (
									<Button
										key={`${question.id}:${index}`}
										className={`ask-inline-bar-option min-h-[30px] flex-1 max-w-full items-start justify-start px-3.5 py-1.5 text-left break-words whitespace-normal${props.answer === value ? " selected" : ""}`}
										variant="ghost"
										disabled={props.responding}
										onClick={() => props.onAnswer(value, label)}
									>
										<span className="text-[13px] font-medium leading-[1.6] text-text-primary">{label}</span>
										{description ? <span className="text-xs font-normal text-text-tertiary">{description}</span> : null}
									</Button>
								);
							})}
						</div>
						{question.allowOther !== false ? (
							<div className="flex w-full items-center gap-2">
								<input
									className="h-9 flex-1 rounded-sm border border-border-subtle bg-bg-panel px-2.5 text-[13px] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
									value={props.inputValue}
									placeholder={question.placeholder || t("ask.customPlaceholder")}
									disabled={props.responding}
									onChange={(event) => props.onInputChange(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											props.onSubmitInput();
										}
									}}
								/>
								<Button
																		variant="default"
									disabled={props.responding || !props.inputValue.trim()}
									onClick={props.onSubmitInput}
								>
									{t("ask.submit")}
								</Button>
							</div>
						) : null}
					</>
				) : question.type === "editor" ? (
					<textarea
						className="h-auto min-h-[80px] w-full flex-1 resize-y rounded-sm border border-border-subtle bg-bg-panel p-2 text-[13px] leading-[1.6] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
						value={props.inputValue}
						placeholder={question.placeholder || t("ask.editorPlaceholder")}
						disabled={props.responding}
						onChange={(event) => {
							props.onInputChange(event.target.value);
							props.onAnswer(event.target.value || undefined, event.target.value);
						}}
					/>
				) : (
					<div className="flex w-full items-center gap-2">
						<input
							className="h-9 flex-1 rounded-sm border border-border-subtle bg-bg-panel px-2.5 text-[13px] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
							value={props.inputValue}
							placeholder={question.placeholder || t("ask.inputPlaceholder")}
							disabled={props.responding}
							onChange={(event) => props.onInputChange(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									props.onSubmitInput();
								}
							}}
						/>
						<Button
														variant="default"
							disabled={props.responding || !props.inputValue.trim()}
							onClick={props.onSubmitInput}
						>
							{t("ask.submit")}
						</Button>
					</div>
				)}
			</div>
			<div className="ask-batch-nav">
				{props.onPrevious ? (
					<Button className="ask-batch-nav-btn" variant="ghost" disabled={props.responding} onClick={props.onPrevious}>
						{t("ask.batchPrev")}
					</Button>
				) : null}
				<span className="ask-batch-nav-spacer" />
				<Button
					className="ask-batch-nav-btn primary"
					variant="ghost"
					disabled={props.responding || props.nextDisabled}
					onClick={props.onNext}
				>
					{props.questionIndex < props.total - 1
						? t("ask.batchNext")
						: props.finalLabel ?? t("ask.batchGoReview")}
				</Button>
			</div>
		</div>
	);
}

export function SessionRuntimeUiOverlay({ sessionId, runtime, ui, responder }: SessionRuntimeUiOverlayProps) {
	const active = Boolean(
		runtime &&
		ui &&
		runtime.status !== "detached" &&
		runtime.status !== "error" &&
		runtime.status !== "closed" &&
		runtime.agentId === ui.agentId &&
		runtime.runtimeGeneration === ui.runtimeGeneration,
	);
	const request = useMemo(
		() => active && ui
			? Object.values(ui.requests).find((entry) => entry.status === "pending" || entry.status === "responding")?.request
			: undefined,
		[active, ui],
	);
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

	if (request.method === "batch_ask") {
		return (
			<BatchAskInlineBar
				request={request}
				responding={responding}
				onCancel={cancel}
				onSubmit={(answers) => void answer({ value: answers })}
			/>
		);
	}

	return (
		<div className="ask-inline-bar rounded-t-md border border-b-0 border-border-strong bg-[color:color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-panel))] p-3">
			<div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
				<MessageCircle size={14} aria-hidden="true" />
				<span>{t("ask.toolName")}</span>
				{request.method === "select" && request.options?.length ? (
					<span className="ml-2 text-[11px] font-normal text-text-tertiary">{t("ask.cancelHint")}</span>
				) : null}
				<Button variant="ghost" size="icon"
										aria-label={t("common.close")} title={t("common.close")}
					disabled={responding}
					onClick={cancel}
				>
					<X size={14} aria-hidden="true" />
				</Button>
			</div>
			<div className="mb-3 text-sm font-medium leading-[1.6] break-words text-text-primary">{request.title || t("ask.defaultTitle")}</div>
			<div>
				{request.method === "select" && request.options?.length ? (
					<div className="flex max-h-[180px] flex-wrap gap-2 overflow-y-auto pr-1">
						{request.options.map((option) => (
							<Button
								key={`${request.requestId}:${option}`}
								className="ask-inline-bar-option min-h-[30px] flex-1 max-w-full items-start justify-start px-3.5 py-1.5 text-left break-words whitespace-normal"
								variant="ghost"
								disabled={responding}
								onClick={() => void answer({ value: option })}
							>
								<span className="text-[13px] font-medium leading-[1.6] text-text-primary">{option}</span>
							</Button>
						))}
						{request.allowOther ? (
							<div className="flex w-full items-center gap-2">
								<input
									className="h-9 flex-1 rounded-sm border border-border-subtle bg-bg-panel px-2.5 text-[13px] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
									value={value}
									placeholder={t("ask.customPlaceholder")}
									disabled={responding}
									onChange={(event) => setValue(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && value.trim()) void answer({ value: value.trim() });
									}}
								/>
								<Button
																		variant="default"
									disabled={responding || !value.trim()}
									onClick={() => void answer({ value: value.trim() })}
								>
									{t("ask.submit")}
								</Button>
							</div>
						) : null}
					</div>
				) : null}
				{request.method === "confirm" ? (
					<div className="flex gap-2">
						<Button className="ask-inline-bar-option ask-inline-bar-option-yes" variant="ghost" disabled={responding} onClick={() => void answer({ confirmed: true, value: true })}>
							{t("common.confirm")}
						</Button>
						<Button className="ask-inline-bar-option ask-inline-bar-option-no" variant="ghost" disabled={responding} onClick={() => void answer({ confirmed: false, value: false })}>
							{t("common.cancel")}
						</Button>
					</div>
				) : null}
				{request.method === "input" ? (
					<div className="flex w-full items-center gap-2">
						<input
							className="h-9 flex-1 rounded-sm border border-border-subtle bg-bg-panel px-2.5 text-[13px] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
							autoFocus
							value={value}
							placeholder={request.placeholder || t("ask.inputPlaceholder")}
							disabled={responding}
							onChange={(event) => setValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && value.trim()) void answer({ value: value.trim() });
							}}
						/>
						<Button className="ask-inline-bar-submit-btn" variant="default" disabled={responding || !value.trim()} onClick={() => void answer({ value: value.trim() })}>
							{t("ask.submit")}
						</Button>
					</div>
				) : null}
				{request.method === "editor" ? (
					<div className="flex w-full items-center gap-2">
						<textarea
							className="h-auto min-h-[80px] w-full flex-1 resize-y rounded-sm border border-border-subtle bg-bg-panel p-2 text-[13px] leading-[1.6] text-text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--color-accent)] focus:shadow-[var(--focus-ring)]"
							autoFocus
							value={value}
							placeholder={request.placeholder || t("ask.editorPlaceholder")}
							disabled={responding}
							onChange={(event) => setValue(event.target.value)}
						/>
						<Button className="ask-inline-bar-submit-btn" variant="default" disabled={responding || !value.trim()} onClick={() => void answer({ value })}>
							{t("ask.submit")}
						</Button>
					</div>
				) : null}
			</div>
		</div>
	);
}
