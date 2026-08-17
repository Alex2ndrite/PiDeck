import { useEffect, useMemo, useRef, useState } from "react";
import type { AvailableModel, DelegationRole, SessionRecord } from "../../../../shared/types";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui-shadcn/select";
import { Textarea } from "../ui-shadcn/textarea";
import { THINKING_LEVELS } from "../session/sessionPickerOptions";

const ROLES: readonly DelegationRole[] = ["explore", "implement", "review", "consult"];
const ROLE_LABEL_KEYS: Record<DelegationRole, "delegation.role.explore" | "delegation.role.implement" | "delegation.role.review" | "delegation.role.consult"> = {
	explore: "delegation.role.explore",
	implement: "delegation.role.implement",
	review: "delegation.role.review",
	consult: "delegation.role.consult",
};
function isDelegationRole(value: string): value is DelegationRole {
	return ROLES.some((item) => item === value);
}

export function DelegationDialog(props: {
	open: boolean;
	parent: SessionRecord | undefined;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { task: string; role: DelegationRole; model?: { provider: string; modelId: string }; thinkingLevel?: string }) => Promise<void>;
}) {
	const [task, setTask] = useState("");
	const [role, setRole] = useState<DelegationRole>("implement");
	const [models, setModels] = useState<AvailableModel[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelKey, setModelKey] = useState("");
	const [thinkingLevel, setThinkingLevel] = useState("__default__");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const requestSequence = useRef(0);

	useEffect(() => {
		if (!props.open || !props.parent) return;
		setTask("");
		setRole("implement");
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
		return () => { requestSequence.current += 1; };
	}, [props.open, props.parent]);

	const selectedModel = useMemo(() => {
		if (!modelKey || modelKey === "__default__") return undefined;
		const model = models.find((candidate) => JSON.stringify([candidate.provider, candidate.id]) === modelKey);
		return model ? { provider: model.provider, modelId: model.id } : undefined;
	}, [modelKey, models]);

	const submit = async () => {
		const normalized = task.trim();
		if (!normalized) { setError(t("delegation.invalidTask")); return; }
		setSubmitting(true);
		setError(undefined);
		try {
			await props.onSubmit({ task: normalized, role, model: selectedModel, ...(thinkingLevel !== "__default__" ? { thinkingLevel } : {}) });
			props.onOpenChange(false);
		} catch {
			setError(t("delegation.failed"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
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
						<Select value={role} onValueChange={(value) => { if (isDelegationRole(value)) setRole(value); }} disabled={submitting}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>{ROLES.map((item) => <SelectItem key={item} value={item}>{t(ROLE_LABEL_KEYS[item])}</SelectItem>)}</SelectContent>
						</Select>
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
						<span>{t("delegation.contextFresh")}</span>
						<span>{t("delegation.workspaceShared")}</span>
					</div>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" type="button" onClick={() => props.onOpenChange(false)} disabled={submitting}>{t("delegation.cancel")}</Button>
					<Button type="button" onClick={() => void submit()} disabled={submitting || !task.trim()}>{submitting ? t("delegation.creating") : t("delegation.create")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
