import { atom } from "jotai";
import type { DelegationRecord } from "../../../shared/types";

export const delegationRecordsAtom = atom<DelegationRecord[]>([]);
export const delegationChildIdsAtom = atom((get) => new Set(get(delegationRecordsAtom).map((record) => record.childSessionId)));
export const upsertDelegationRecordAtom = atom(null, (get, set, record: DelegationRecord) => {
	const records = get(delegationRecordsAtom);
	const index = records.findIndex((candidate) => candidate.id === record.id);
	const next = records.slice();
	if (index < 0) next.push(record);
	else next[index] = record;
	set(delegationRecordsAtom, next);
});
