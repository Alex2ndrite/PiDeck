import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	CreateDelegationInput,
	DelegationRecord,
	DelegationRole,
} from "../../shared/types";
import { renameWithRetry } from "../utils/fsRetry";

const ROLES: readonly DelegationRole[] = ["explore", "implement", "review", "consult"];

function isDelegationRole(value: string): value is DelegationRole {
	return ROLES.some((role) => role === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(record: DelegationRecord): DelegationRecord {
	return {
		...record,
		model: record.model ? { ...record.model } : undefined,
		workspace: { ...record.workspace },
	};
}

function validateRecord(value: unknown): value is DelegationRecord {
	if (!isRecord(value)) return false;
	const model = value.model;
	const workspace = value.workspace;
	return typeof value.id === "string" && value.id.length > 0
		&& typeof value.parentSessionId === "string" && value.parentSessionId.length > 0
		&& typeof value.childSessionId === "string" && value.childSessionId.length > 0
		&& typeof value.task === "string" && value.task.length > 0
		&& typeof value.role === "string" && isDelegationRole(value.role)
		&& (model === undefined || (isRecord(model) && typeof model.provider === "string" && model.provider.length > 0 && typeof model.modelId === "string" && model.modelId.length > 0))
		&& value.contextMode === "fresh"
		&& isRecord(workspace) && workspace.mode === "shared" && typeof workspace.path === "string" && workspace.path.length > 0
		&& typeof value.createdAt === "number" && Number.isFinite(value.createdAt);
}

/** Durable relation store. Transcript data deliberately stays in Pi's session JSONL files. */
export class DelegationStore {
	private records: DelegationRecord[] = [];
	private loaded = false;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(private readonly filePath: string) {}

	async load(): Promise<void> {
		if (this.loaded) return;
		try {
			const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
			if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.delegations) || !parsed.delegations.every(validateRecord)) {
				throw new Error(`Invalid delegation store: ${this.filePath}`);
			}
			this.records = parsed.delegations.map(clone);
		} catch (error) {
			if (isMissingFileError(error)) this.records = [];
			else throw error;
		}
		this.loaded = true;
	}

	list(): DelegationRecord[] {
		this.assertLoaded();
		return this.records.map(clone);
	}

	findByChild(childSessionId: string): DelegationRecord | undefined {
		this.assertLoaded();
		const record = this.records.find((candidate) => candidate.childSessionId === childSessionId);
		return record ? clone(record) : undefined;
	}

	async create(input: CreateDelegationInput & { childSessionId: string; workspacePath: string }): Promise<DelegationRecord> {
		this.assertLoaded();
		const record: DelegationRecord = {
			id: randomUUID(),
			parentSessionId: input.parentSessionId,
			childSessionId: input.childSessionId,
			task: input.task,
			role: input.role,
			model: input.model ? { ...input.model } : undefined,
			contextMode: "fresh",
			workspace: { mode: "shared", path: input.workspacePath },
			createdAt: Date.now(),
		};
		await this.enqueueWrite((records) => [...records, record]);
		return clone(record);
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new Error("DelegationStore.load() must complete before use");
	}

	private enqueueWrite(mutate: (records: DelegationRecord[]) => DelegationRecord[]): Promise<void> {
		const operation = this.writeQueue.catch(() => undefined).then(async () => {
			const nextRecords = mutate(this.records.map(clone));
			await this.writeSnapshot(nextRecords);
			this.records = nextRecords.map(clone);
		});
		this.writeQueue = operation.then(() => undefined, () => undefined);
		return operation;
	}

	private async writeSnapshot(records: DelegationRecord[]): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
		try {
			const handle = await open(tempPath, "w");
			try {
				await handle.writeFile(JSON.stringify({ version: 1, delegations: records.map(clone) }, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await renameWithRetry(tempPath, this.filePath);
		} finally {
			await unlink(tempPath).catch(() => undefined);
		}
	}
}

function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}
