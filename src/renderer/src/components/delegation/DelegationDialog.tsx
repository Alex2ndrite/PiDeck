import { useEffect, useMemo, useRef, useState } from "react";
import type {
	AvailableModel,
	CreateDelegationInput,
	DelegationContextMode,
	DelegationRole,
	DelegationSelectedContextMessage,
	DelegationWorkspaceMode,
	SessionRecord,
	SessionSummary,
} from "../../../../shared/types";
import { DELEGATION_BRIEF_LIMITS } from "../../../../shared/delegationBrief";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui-shadcn/select";
import { Textarea } from "../ui-shadcn/textarea";
import { THINKING_LEVELS } from "../session/sessionPickerOptions";
import { SessionReferenceModal, type SessionReferenceResult } from "../app/SessionReferenceModal";

const ROLES: readonly DelegationRole[] = ["explore", "implement", "review", "consult"];
const CONTEXT_MODES: readonly DelegationContextMode[] = ["fresh", "selected", "fork"];
const WORKSPACE_MODES: readonly DelegationWorkspaceMode[] = ["shared", "worktree"];
const ROLE_LABEL_KEYS: Record<DelegationRole, "delegation.role.explore" | "delegation.role.implement" | "delegation.role.review" | "delegation.role.consult"> = {
	explore: "delegation.role.explore",
	implement: "delegation.role.implement",
	review: "delegation.role.review",
	consult: "delegation.role.consult",
};
function isDelegationRole(value: string): value is DelegationRole {
	return ROLES.some((item) => item === value);
}

function isContextMode(value: string): value is DelegationContextMode {
	return CONTEXT_MODES.some((item) => item === value);
}

function isWorkspaceMode(value: string): value is DelegationWorkspaceMode {
	return WORKSPACE_MODES.some((item) => item === value);
}

type DelegationDialogInput = Omit<CreateDelegationInput, "parentSessionId">;

export function DelegationDialog(props: {
	open: boolean;
	parent: SessionRecord | undefined;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: DelegationDialogInput) => Promise<void>;
}) {
	const [task, setTask] = useState("");
	const [role, setRole] = useState<DelegationRole>("implement");
	const [contextMode, setContextMode] = useState<DelegationContextMode>("fresh");
	const [workspaceMode, setWorkspaceMode] = useState<DelegationWorkspaceMode>("shared");
	const [selectedContext, setSelectedContext] = useState<DelegationSelectedContextMessage[]>([]);
	const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
	const [constraints, setConstraints] = useState("");
	const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
	const [relevantFiles, setRelevantFiles] = useState("");
	const [referenceOpen, setReferenceOpen] = useState(false);
	const [gitAvailable, setGitAvailable] = useState(false);
	const [gitChecking, setGitChecking] = useState(false);
	const [models, setModels] = useState<AvailableModel[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelKey, setModelKey] = useState("");
	const [thinkingLevel, setThinkingLevel] = useState("__default__");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const requestSequence = useRef(0);
	const gitRequestSequence = useRef(0);
	const roleRef = useRef(role);
	roleRef.current = role;

	useEffect(() => {
		if (!props.open || !props.parent) return;
		setTask("");
		setRole("implement");
		roleRef.current = "implement";
		setContextMode("fresh");
		setWorkspaceMode("shared");
		setSelectedContext([]);
		setSelectedIndices([]);
		setConstraints("");
		setAcceptanceCriteria("");
		setRelevantFiles("");
		setReferenceOpen(false);
		setGitAvailable(false);
		setError(undefined);
		setModels([]);
		setModelKey("");
		setThinkingLevel("__default__");
		const sequence = ++requestSequence.current;
		setModelsLoading(true);
		void desktopApi.projects.listModels(props.parent.projectId).then((next) => {
			if (sequence !== requestSequence.current) return;
			setModels(next);
			const preferred = props.parent?.model;
			const preferredKey = preferred ? JSON.stringify([preferred.provider, preferred.modelId]) : "";
			setModelKey(next.some((model) => JSON.stringify([model.provider, model.id]) === preferredKey) ? preferredKey : "");
		}).catch(() => {
			if (sequence === requestSequence.current) setModels([]);
		}).finally(() => {
			if (sequence === requestSequence.current) setModelsLoading(false);
		});
		const gitSequence = ++gitRequestSequence.current;
		setGitChecking(true);
		void desktopApi.git.branches(props.parent.projectId).then((info) => {
			if (gitSequence !== gitRequestSequence.current) return;
			const available = Boolean(info.current?.trim()) || info.branches.some((branch) => Boolean(branch.trim()));
			setGitAvailable(available);
			if (available && roleRef.current === "implement") setWorkspaceMode("worktree");
		}).catch(() => {
			if (gitSequence === gitRequestSequence.current) {
				setGitAvailable(false);
				setWorkspaceMode("shared");
			}
		}).finally(() => {
			if (gitSequence === gitRequestSequence.current) setGitChecking(false);
		});
		return () => {
			requestSequence.current += 1;
			gitRequestSequence.current += 1;
		};
	}, [props.open, props.parent]);

	const selectedModel = useMemo(() => {
		if (!modelKey || modelKey === "__default__") return undefined;
		const model = models.find((candidate) => JSON.stringify([candidate.provider, candidate.id]) === modelKey);
		return model ? { provider: model.provider, modelId: model.id } : undefined;
	}, [modelKey, models]);

	const referenceSession = useMemo<SessionSummary | undefined>(() => {
		if (!props.parent) return undefined;
		return {
			id: props.parent.id,
			filePath: props.parent.filePath ?? props.parent.projectPath ?? "",
			name: props.parent.title,
			preview: props.parent.preview,
			updatedAt: props.parent.updatedAt,
			messageCount: props.parent.messageCount,
		};
	}, [props.parent]);

	const handleRoleChange = (value: string) => {
		if (!isDelegationRole(value)) return;
		roleRef.current = value;
		setRole(value);
		setWorkspaceMode(value === "implement" && gitAvailable ? "worktree" : "shared");
	};

	const handleContextChange = (value: string) => {
		if (!isContextMode(value)) return;
		setContextMode(value);
		if (value === "selected" && selectedContext.length === 0) setReferenceOpen(true);
	};

	const handleReferenceConfirm = (result: SessionReferenceResult, indices: number[]) => {
		const nextSelected: DelegationSelectedContextMessage[] = [];
		for (const message of result.messages) {
			if (message.role === "user") nextSelected.push({ role: "user", content: message.content });
			if (message.role === "assistant") nextSelected.push({ role: "assistant", content: message.content });
		}
		setSelectedContext(nextSelected);
		setSelectedIndices(indices);
		setReferenceOpen(false);
	};

	const submit = async () => {
		const normalized = task.trim();
		if (!normalized) { setError(t("delegation.invalidTask")); return; }
		if (contextMode === "selected" && selectedContext.length === 0) { setError(t("delegation.selectedContextRequired")); return; }
		setSubmitting(true);
		setError(undefined);
		try {
			await props.onSubmit({
				task: normalized,
				role,
				model: selectedModel,
				contextMode,
				workspaceMode,
				selectedContext: contextMode === "selected" ? selectedContext : undefined,
				constraints: contextMode === "selected" ? constraints.trim() || undefined : undefined,
				acceptanceCriteria: contextMode === "selected" ? acceptanceCriteria.trim() || undefined : undefined,
				relevantFiles: contextMode === "selected" ? relevantFiles.trim() || undefined : undefined,
				...(thinkingLevel !== "__default__" ? { thinkingLevel } : {}),
			});
			props.onOpenChange(false);
		} catch {
			setError(t("delegation.failed"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<>
			<Dialog open={props.open} onOpenChange={props.onOpenChange}>
				<DialogContent className="max-h-[calc(100vh-32px)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("delegation.title")}</DialogTitle>
					<DialogDescription>{props.parent?.title ?? ""}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<label className="grid gap-2 text-sm font-medium" htmlFor="delegation-task">
						{t("delegation.task")}
						<Textarea id="delegation-task" value={task} onChange={(event) => setTask(event.target.value)} placeholder={t("delegation.taskPlaceholder")} disabled={submitting} />
					</label>
					<label className="grid gap-2 text-sm font-medium">
						{t("delegation.role")}
						<Select value={role} onValueChange={handleRoleChange} disabled={submitting}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>{ROLES.map((item) => <SelectItem key={item} value={item}>{t(ROLE_LABEL_KEYS[item])}</SelectItem>)}</SelectContent>
						</Select>
					</label>
					<label className="grid gap-2 text-sm font-medium">
						{t("delegation.context")}
						<Select value={contextMode} onValueChange={handleContextChange} disabled={submitting}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="fresh">{t("delegation.contextFreshOption")}</SelectItem>
								<SelectItem value="selected">{t("delegation.contextSelectedOption")}</SelectItem>
								<SelectItem value="fork">{t("delegation.contextForkOption")}</SelectItem>
							</SelectContent>
						</Select>
					</label>
					{contextMode === "selected" ? (
						<div className="grid gap-2 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
							<div className="flex items-center justify-between gap-3">
								<span>{t("delegation.selectedContextCount", { count: selectedContext.length })}</span>
								<Button type="button" variant="outline" size="sm" onClick={() => setReferenceOpen(true)} disabled={submitting || !referenceSession}>
									{t("delegation.selectContext")}
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">{t("delegation.selectedContextLimit", { count: DELEGATION_BRIEF_LIMITS.selectedMessages })}</p>
							<label className="grid gap-2 font-medium" htmlFor="delegation-constraints">
								{t("delegation.constraints")}
								<Textarea id="delegation-constraints" value={constraints} maxLength={DELEGATION_BRIEF_LIMITS.constraints} onChange={(event) => setConstraints(event.target.value)} disabled={submitting} />
							</label>
							<label className="grid gap-2 font-medium" htmlFor="delegation-acceptance">
								{t("delegation.acceptanceCriteria")}
								<Textarea id="delegation-acceptance" value={acceptanceCriteria} maxLength={DELEGATION_BRIEF_LIMITS.acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} disabled={submitting} />
							</label>
							<label className="grid gap-2 font-medium" htmlFor="delegation-relevant-files">
								{t("delegation.relevantFiles")}
								<Textarea id="delegation-relevant-files" value={relevantFiles} maxLength={DELEGATION_BRIEF_LIMITS.relevantFiles} placeholder={t("delegation.relevantFilesPlaceholder")} onChange={(event) => setRelevantFiles(event.target.value)} disabled={submitting} />
							</label>
						</div>
					) : null}
					{contextMode === "fork" ? <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">{t("delegation.contextForkDescription")}</p> : null}
					<label className="grid gap-2 text-sm font-medium">
						{t("delegation.workspace")}
						<Select value={workspaceMode} onValueChange={(value) => {
							if (!isWorkspaceMode(value)) return;
							if (value === "worktree" && (!gitAvailable || role !== "implement")) return;
							setWorkspaceMode(value);
						}} disabled={submitting || role !== "implement"}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="shared">{t("delegation.workspaceSharedOption")}</SelectItem>
								<SelectItem value="worktree" disabled={!gitAvailable || gitChecking}>{t("delegation.workspaceWorktreeOption")}</SelectItem>
							</SelectContent>
						</Select>
						{role === "implement" && gitChecking ? <span className="text-xs text-muted-foreground">{t("delegation.worktreeChecking")}</span> : null}
						{role === "implement" && !gitChecking && !gitAvailable ? <span className="text-xs text-muted-foreground">{t("delegation.worktreeUnavailable")}</span> : null}
					</label>
					<label className="grid gap-2 text-sm font-medium">
						{t("delegation.model")}
						<Select value={modelKey} onValueChange={(value) => { setModelKey(value); setThinkingLevel("__default__"); }} disabled={submitting}>
							<SelectTrigger className="w-full"><SelectValue placeholder={t("delegation.defaultModel")} /></SelectTrigger>
							<SelectContent>
								{modelsLoading ? <SelectItem value="__loading__" disabled>{t("delegation.modelsLoading")}</SelectItem> : null}
								{!modelsLoading && models.length === 0 ? <SelectItem value="__empty__" disabled>{t("delegation.modelsEmpty")}</SelectItem> : null}
								{models.map((model) => <SelectItem key={JSON.stringify([model.provider, model.id])} value={JSON.stringify([model.provider, model.id])}>{model.provider}/{model.name || model.id}</SelectItem>)}
							</SelectContent>
						</Select>
					</label>
					<label className="grid gap-2 text-sm font-medium">
						{t("delegation.thinking")}
						<Select value={thinkingLevel} onValueChange={setThinkingLevel} disabled={submitting}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="__default__">{t("delegation.defaultThinking")}</SelectItem>
								{THINKING_LEVELS.map((level) => <SelectItem key={level.value} value={level.value}>{t(level.labelKey)}</SelectItem>)}
							</SelectContent>
						</Select>
					</label>
					<div className="grid gap-1 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
						<span>{contextMode === "fresh" ? t("delegation.contextFreshOption") : contextMode === "selected" ? t("delegation.contextSelectedOption") : t("delegation.contextForkOption")}</span>
						<span>{workspaceMode === "shared" ? t("delegation.workspaceSharedOption") : t("delegation.workspaceWorktreeOption")}</span>
					</div>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" type="button" onClick={() => props.onOpenChange(false)} disabled={submitting}>{t("delegation.cancel")}</Button>
					<Button type="button" onClick={() => void submit()} disabled={submitting || !task.trim()}>{submitting ? t("delegation.creating") : t("delegation.create")}</Button>
				</DialogFooter>
				</DialogContent>
			</Dialog>
			{referenceOpen && referenceSession ? (
				<SessionReferenceModal
					session={referenceSession}
					maxSelected={DELEGATION_BRIEF_LIMITS.selectedMessages}
					initialSelected={new Set(selectedIndices)}
					title={t("delegation.selectContextTitle")}
					confirmLabel={t("delegation.selectContextConfirm")}
					onClose={() => setReferenceOpen(false)}
					onConfirm={handleReferenceConfirm}
					loadMessages={(sessionId) => desktopApi.sessions.readReferenceMessages(sessionId)}
				/>
			) : null}
		</>
	);
}
