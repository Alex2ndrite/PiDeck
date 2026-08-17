import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DelegationHandoffFields, DelegationRecord, ReturnDelegationResult } from "../../../shared/types";
import { sessionMessageCacheBySessionIdAtomFamily } from "../atoms";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";
import { DELEGATION_HANDOFF_LIMITS } from "../../../shared/delegationHandoff";

function latestAssistantText(messages: readonly { role: string; text: string }[] | undefined): string {
	if (!messages) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant" && message.text.trim()) {
			return message.text.trim().slice(0, DELEGATION_HANDOFF_LIMITS.result);
		}
	}
	return "";
}

export function useDelegationHandoffController(options: {
	onReturned?: (result: ReturnDelegationResult, relation: DelegationRecord) => void;
}) {
	const [open, setOpen] = useState(false);
	const [relation, setRelation] = useState<DelegationRecord | undefined>();
	const [fields, setFields] = useState<DelegationHandoffFields>({ task: "", result: "" });
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const resultTouched = useRef(false);
	const cache = useAtomValue(sessionMessageCacheBySessionIdAtomFamily(relation?.childSessionId ?? ""));

	useEffect(() => {
		if (!open || !relation || resultTouched.current) return;
		const inferred = latestAssistantText(cache?.messages);
		setFields((current) => current.result === inferred ? current : { ...current, result: inferred });
	}, [cache, open, relation]);

	const openFor = useCallback((nextRelation: DelegationRecord) => {
		resultTouched.current = false;
		setRelation(nextRelation);
		setFields({ task: nextRelation.task, result: "" });
		setError(undefined);
		setOpen(true);
	}, []);
	const close = useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setRelation(undefined);
			setError(undefined);
			resultTouched.current = false;
		}
	}, []);
	const updateFields = useCallback((next: DelegationHandoffFields) => {
		setFields((current) => {
			if (current.result !== next.result) resultTouched.current = true;
			return next;
		});
	}, []);
	const submit = useCallback(async () => {
		if (!relation) return;
		const task = fields.task.trim();
		const result = fields.result.trim();
		if (!task) {
			setError(t("delegation.invalidTask"));
			return;
		}
		if (!result) {
			setError(t("delegation.handoffResultRequired"));
			return;
		}
		setSubmitting(true);
		setError(undefined);
		try {
			const response = await desktopApi.delegations.returnToParent({
				childSessionId: relation.childSessionId,
				task: task.slice(0, DELEGATION_HANDOFF_LIMITS.task),
				result: result.slice(0, DELEGATION_HANDOFF_LIMITS.result),
				changedFiles: fields.changedFiles?.trim().slice(0, DELEGATION_HANDOFF_LIMITS.changedFiles) || undefined,
				validation: fields.validation?.trim().slice(0, DELEGATION_HANDOFF_LIMITS.validation) || undefined,
			});
			if (!response.prompt.accepted) {
				setError(t("delegation.handoffFailed"));
				showNotice(t("delegation.handoffFailed"), 3000, "warning");
				return;
			}
			showNotice(t("delegation.handoffReturned"), 3000, "info");
			options.onReturned?.(response, relation);
			close(false);
		} catch {
			setError(t("delegation.handoffFailed"));
			showNotice(t("delegation.handoffFailed"), 3000, "error");
		} finally {
			setSubmitting(false);
		}
	}, [close, fields, options.onReturned, relation]);

	return { dialogOpen: open, relation, fields, error, submitting, open: openFor, setOpen: close, setFields: updateFields, submit };
}
