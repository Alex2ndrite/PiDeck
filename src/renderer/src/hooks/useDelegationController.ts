import { useCallback, useEffect, useState } from "react";
import { useSetAtom, useStore } from "jotai";
import type { CreateDelegationInput, SessionRecord } from "../../../shared/types";
import { delegationRecordsAtom, upsertDelegationRecordAtom } from "../atoms";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

export function useDelegationController(options: {
	parent: SessionRecord | undefined;
	onCreated?: (result: Awaited<ReturnType<typeof desktopApi.delegations.create>>) => void | Promise<void>;
}) {
	type DelegationCreateInput = Omit<CreateDelegationInput, "parentSessionId">;
	const setRecords = useSetAtom(delegationRecordsAtom);
	const store = useStore();
	const upsert = useSetAtom(upsertDelegationRecordAtom);
	const [open, setOpen] = useState(false);
	const [parentOverride, setParentOverride] = useState<SessionRecord | undefined>();
	const parent = parentOverride ?? options.parent;

	useEffect(() => {
		void desktopApi.delegations.list().then((next) => {
			const current = store.get(delegationRecordsAtom);
			const merged = new Map(next.map((record) => [record.id, record]));
			for (const record of current) merged.set(record.id, record);
			setRecords([...merged.values()]);
		}).catch(() => showNotice(t("delegation.loadFailed"), 3000, "error"));
	}, [setRecords, store]);

	const openFor = useCallback((nextParent: SessionRecord) => { setParentOverride(nextParent); setOpen(true); }, []);
	const close = useCallback((next: boolean) => { setOpen(next); if (!next) setParentOverride(undefined); }, []);
	const create = useCallback(async (input: DelegationCreateInput) => {
		if (!parent) throw new Error(t("delegation.failed"));
		const result = await desktopApi.delegations.create({ parentSessionId: parent.id, ...input });
		upsert(result.delegation);
		await options.onCreated?.(result);
		showNotice(result.prompt.accepted ? t("delegation.created") : t("delegation.taskDeliveryFailed"), 3000, result.prompt.accepted ? "info" : "warning");
	}, [parent, options.onCreated, upsert]);

	return { parent, dialogOpen: open, open: openFor, setOpen: close, create };
}
