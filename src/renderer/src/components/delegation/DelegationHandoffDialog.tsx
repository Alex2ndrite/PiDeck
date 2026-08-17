import type { DelegationRecord, DelegationHandoffFields } from "../../../../shared/types";
import { DELEGATION_HANDOFF_LIMITS } from "../../../../shared/delegationHandoff";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { Textarea } from "../ui-shadcn/textarea";

export function DelegationHandoffDialog(props: {
	open: boolean;
	relation: DelegationRecord | undefined;
	fields: DelegationHandoffFields;
	error?: string;
	submitting: boolean;
	onOpenChange: (open: boolean) => void;
	onFieldsChange: (fields: DelegationHandoffFields) => void;
	onSubmit: () => void;
}) {
	const update = (key: keyof DelegationHandoffFields, value: string) => {
		props.onFieldsChange({ ...props.fields, [key]: value });
	};
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("delegation.handoffTitle")}</DialogTitle>
					<DialogDescription>{t("delegation.handoffChildSession")}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-1 text-sm">
						<span className="font-medium">{t("delegation.handoffChildSession")}</span>
						<code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{props.relation?.childSessionId ?? ""}</code>
					</div>
					<label className="grid gap-2 text-sm font-medium" htmlFor="delegation-handoff-task">
						{t("delegation.handoffTask")}
						<Textarea id="delegation-handoff-task" value={props.fields.task} maxLength={DELEGATION_HANDOFF_LIMITS.task} onChange={(event) => update("task", event.target.value)} disabled={props.submitting} />
					</label>
					<label className="grid gap-2 text-sm font-medium" htmlFor="delegation-handoff-result">
						{t("delegation.handoffResult")}
						<Textarea id="delegation-handoff-result" value={props.fields.result} maxLength={DELEGATION_HANDOFF_LIMITS.result} placeholder={t("delegation.handoffResultPlaceholder")} onChange={(event) => update("result", event.target.value)} disabled={props.submitting} />
					</label>
					<label className="grid gap-2 text-sm font-medium" htmlFor="delegation-handoff-files">
						{t("delegation.handoffChangedFiles")}
						<Textarea id="delegation-handoff-files" value={props.fields.changedFiles ?? ""} maxLength={DELEGATION_HANDOFF_LIMITS.changedFiles} placeholder={t("delegation.handoffChangedFilesPlaceholder")} onChange={(event) => update("changedFiles", event.target.value)} disabled={props.submitting} />
					</label>
					<label className="grid gap-2 text-sm font-medium" htmlFor="delegation-handoff-validation">
						{t("delegation.handoffValidation")}
						<Textarea id="delegation-handoff-validation" value={props.fields.validation ?? ""} maxLength={DELEGATION_HANDOFF_LIMITS.validation} placeholder={t("delegation.handoffValidationPlaceholder")} onChange={(event) => update("validation", event.target.value)} disabled={props.submitting} />
					</label>
					{props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" type="button" onClick={() => props.onOpenChange(false)} disabled={props.submitting}>{t("delegation.cancel")}</Button>
					<Button type="button" onClick={props.onSubmit} disabled={props.submitting || !props.fields.result.trim()}>{props.submitting ? t("delegation.handoffSubmitting") : t("delegation.handoffSubmit")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
