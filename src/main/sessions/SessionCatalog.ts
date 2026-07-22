import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
	AgentTab,
	SessionEnvironment,
	SessionRecord,
	SessionSource,
	SessionSummary,
} from "../../shared/types";
import {
	buildSessionOriginKey,
	buildSummaryOriginKey,
	canonicalizeSessionPath,
	getImportedSessionSourceId,
	getSessionEnvironment,
} from "../../shared/sessionIdentity";

export type SessionCatalogEntry = {
	id: string;
	projectId: string;
	originKey?: string;
	title: string;
	source: SessionSource;
	environment: SessionEnvironment;
	filePath?: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	status: "draft" | "active";
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
	piSessionId?: string;
	createdAt: number;
	updatedAt: number;
};

type SessionCatalogFile = {
	version: 1;
	sessions: SessionCatalogEntry[];
};

type SessionCatalogContext = {
	wslDistro?: string;
	wslUser?: string;
};

function cloneEntry(entry: SessionCatalogEntry): SessionCatalogEntry {
	return {
		...entry,
		model: entry.model ? { ...entry.model } : undefined,
	};
}

function equalModel(
	left?: { provider: string; modelId: string },
	right?: { provider: string; modelId: string },
): boolean {
	return left?.provider === right?.provider && left?.modelId === right?.modelId;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT",
	);
}

export function canAttachRuntimeMetadata(
	entry: SessionCatalogEntry | undefined,
	tab: Partial<AgentTab>,
): boolean {
	if (!entry || !tab.sessionPath) return false;
	if (entry.status === "draft" && !entry.filePath) return true;
	if (!entry.filePath) return false;
	const environment = tab.sessionEnvironment ?? entry.environment;
	return buildSessionOriginKey({
		source: entry.source,
		environment: entry.environment,
		filePath: entry.filePath,
		wslDistro: entry.wslDistro,
		wslUser: entry.wslUser,
		importedSourceId: entry.importedSourceId,
	}) === buildSessionOriginKey({
		source: tab.sessionSource ?? entry.source,
		environment,
		filePath: tab.sessionPath,
		wslDistro: tab.wslDistro ?? entry.wslDistro,
		wslUser: tab.wslUser ?? entry.wslUser,
		importedSourceId: tab.importedSourceId ?? entry.importedSourceId,
	});
}

export class SessionCatalog {
	private entries: SessionCatalogEntry[] = [];
	private loaded = false;
	private writeQueue: Promise<void> = Promise.resolve();
	private skipNextBackup = false;

	private identityContext: SessionCatalogContext;

	constructor(
		private readonly filePath: string,
		identityContext: SessionCatalogContext = {},
	) {
		this.identityContext = { ...identityContext };
	}

	setIdentityContext(context: SessionCatalogContext): void {
		this.identityContext = { ...context };
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		let primaryError: unknown;
		try {
			this.entries = await this.readEntries(this.filePath);
		} catch (error) {
			primaryError = error;
			try {
				this.entries = await this.readEntries(this.backupFilePath());
				this.skipNextBackup = true;
			} catch (backupError) {
				if (isMissingFileError(primaryError) && isMissingFileError(backupError)) {
					this.entries = [];
				} else {
					throw new Error(
						`Failed to load Session catalog or backup: ${String(primaryError)}; ${String(backupError)}`,
					);
				}
			}
		}
		this.loaded = true;
		if (this.skipNextBackup) {
			await this.writeSnapshot(this.entries);
		}
	}

	listEntries(): SessionCatalogEntry[] {
		this.assertLoaded();
		return this.entries.map(cloneEntry);
	}

	get(id: string): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const entry = this.entries.find((candidate) => candidate.id === id);
		return entry ? cloneEntry(entry) : undefined;
	}

	findByFilePath(
		filePath: string,
		environment: SessionEnvironment,
	): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		const entry = this.entries.find((candidate) => (
			candidate.filePath &&
			candidate.environment === environment &&
			canonicalizeSessionPath(candidate.filePath, environment) === target
		));
		return entry ? cloneEntry(entry) : undefined;
	}

	async ensureRuntimeTarget(input: {
		projectId: string;
		title: string;
		source: SessionSource;
		environment: SessionEnvironment;
		filePath: string;
		wslDistro?: string;
		wslUser?: string;
		importedSourceId?: string;
		piSessionId?: string;
	}): Promise<SessionCatalogEntry> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const originKey = buildSessionOriginKey({
				source: input.source,
				environment: input.environment,
				filePath: input.filePath,
				wslDistro: input.wslDistro,
				wslUser: input.wslUser,
				importedSourceId: input.importedSourceId,
			});
			let entry = entries.find((candidate) => {
				if (candidate.originKey === originKey) return true;
				if (!candidate.filePath) return false;
				return buildSessionOriginKey({
					source: candidate.source,
					environment: candidate.environment,
					filePath: candidate.filePath,
					wslDistro: candidate.wslDistro,
					wslUser: candidate.wslUser,
					importedSourceId: candidate.importedSourceId,
				}) === originKey;
			});
			const now = Date.now();
			if (!entry) {
				entry = {
					id: randomUUID(),
					projectId: input.projectId,
					originKey,
					title: input.title,
					source: input.source,
					environment: input.environment,
					filePath: input.filePath,
					wslDistro: input.wslDistro,
					wslUser: input.wslUser,
					importedSourceId: input.importedSourceId,
					piSessionId: input.piSessionId,
					status: "active",
					createdAt: now,
					updatedAt: now,
				};
				entries.push(entry);
			} else {
				entry.projectId = input.projectId;
				entry.originKey = originKey;
				entry.title = input.title;
				entry.source = input.source;
				entry.environment = input.environment;
				entry.filePath = input.filePath;
				entry.wslDistro = input.wslDistro;
				entry.wslUser = input.wslUser;
				entry.importedSourceId = input.importedSourceId;
				entry.piSessionId = input.piSessionId;
				entry.status = "active";
				entry.updatedAt = now;
			}
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async createDraft(input: {
		projectId: string;
		title: string;
		environment: SessionEnvironment;
		source?: SessionSource;
		model?: { provider: string; modelId: string };
		thinkingLevel?: string;
	}): Promise<SessionRecord> {
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const now = Date.now();
			const nextEntry: SessionCatalogEntry = {
				id: randomUUID(),
				projectId: input.projectId,
				title: input.title,
				source: input.source ?? "pi",
				environment: input.environment,
				wslDistro: input.environment === "wsl"
					? this.identityContext.wslDistro
					: undefined,
				wslUser: input.environment === "wsl"
					? this.identityContext.wslUser
					: undefined,
				status: "draft",
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				createdAt: now,
				updatedAt: now,
			};
			entries.push(nextEntry);
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async update(
		id: string,
		patch: Partial<Pick<
			SessionCatalogEntry,
			"title" | "model" | "thinkingLevel" | "updatedAt"
		>>,
	): Promise<SessionRecord> {
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, id);
			if (patch.title !== undefined) nextEntry.title = patch.title;
			if (patch.model !== undefined) nextEntry.model = patch.model;
			if (patch.thinkingLevel !== undefined) nextEntry.thinkingLevel = patch.thinkingLevel;
			nextEntry.updatedAt = patch.updatedAt ?? Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async attachRuntime(input: {
		sessionId: string;
		filePath?: string;
		piSessionId?: string;
		title?: string;
	}): Promise<SessionCatalogEntry> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const entry = this.requireEntry(entries, input.sessionId);
			const previousFilePath = entry.filePath;
			if (input.filePath) entry.filePath = input.filePath;
			if (input.piSessionId) entry.piSessionId = input.piSessionId;
			if (input.title) entry.title = input.title;
			if (entry.filePath) {
				const pathUnchanged = Boolean(
					previousFilePath &&
					canonicalizeSessionPath(previousFilePath, entry.environment) ===
						canonicalizeSessionPath(entry.filePath, entry.environment),
				);
				const nextOriginKey = pathUnchanged && entry.originKey
					? entry.originKey
					: this.originKeyForEntry(entry);
				entry.originKey = nextOriginKey;
				entry.status = "active";

				const duplicateIndex = nextOriginKey
					? entries.findIndex((candidate) => (
						candidate.id !== entry.id && candidate.originKey === nextOriginKey
					))
					: -1;
				if (duplicateIndex >= 0) {
					const duplicate = entries[duplicateIndex];
					entry.model ??= duplicate.model;
					entry.thinkingLevel ??= duplicate.thinkingLevel;
					entry.importedSourceId ??= duplicate.importedSourceId;
					entry.createdAt = Math.min(entry.createdAt, duplicate.createdAt);
					entries.splice(duplicateIndex, 1);
				}
			}
			entry.updatedAt = Date.now();
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async remove(id: string): Promise<boolean> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const index = entries.findIndex((entry) => entry.id === id);
			if (index < 0) return { value: false, changed: false };
			entries.splice(index, 1);
			return { value: true, changed: true };
		});
	}

	async removeByFilePath(
		filePath: string,
		environment: SessionEnvironment,
	): Promise<boolean> {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		return this.enqueueMutation((entries) => {
			const index = entries.findIndex((entry) => (
				entry.filePath &&
				entry.environment === environment &&
				canonicalizeSessionPath(entry.filePath, environment) === target
			));
			if (index < 0) return { value: false, changed: false };
			entries.splice(index, 1);
			return { value: true, changed: true };
		});
	}

	async mergeScanned(
		projectId: string,
		summaries: SessionSummary[],
		context: SessionCatalogContext = this.identityContext,
	): Promise<SessionRecord[]> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const byOrigin = new Map(
				entries
					.filter((entry) => entry.originKey)
					.map((entry) => [entry.originKey!, entry]),
			);
			const summaryById = new Map<string, SessionSummary>();
			let changed = false;

			for (const summary of summaries) {
				const originKey = buildSummaryOriginKey(summary, context);
				const importedSourceId = getImportedSessionSourceId(summary);
				let entry = byOrigin.get(originKey);
				if (!entry) {
					const now = summary.updatedAt || Date.now();
					entry = {
						id: randomUUID(),
						projectId,
						originKey,
						title: summary.name || "Untitled",
						source: summary.source ?? "pi",
						environment: getSessionEnvironment(summary),
						filePath: summary.filePath,
						wslDistro: summary.wsl ? context.wslDistro : undefined,
						wslUser: summary.wsl ? context.wslUser : undefined,
						importedSourceId,
						status: "active",
						createdAt: now,
						updatedAt: now,
					};
					entries.push(entry);
					byOrigin.set(originKey, entry);
					changed = true;
				} else {
					const nextTitle = summary.name || entry.title;
					if (
						entry.projectId !== projectId ||
						entry.filePath !== summary.filePath ||
						entry.title !== nextTitle ||
						entry.source !== (summary.source ?? "pi") ||
						entry.environment !== getSessionEnvironment(summary) ||
						entry.wslDistro !== (summary.wsl ? context.wslDistro : undefined) ||
						entry.wslUser !== (summary.wsl ? context.wslUser : undefined) ||
						entry.importedSourceId !== importedSourceId ||
						entry.status !== "active" ||
						entry.updatedAt !== summary.updatedAt
					) {
						entry.projectId = projectId;
						entry.filePath = summary.filePath;
						entry.title = nextTitle;
						entry.source = summary.source ?? "pi";
						entry.environment = getSessionEnvironment(summary);
						entry.wslDistro = summary.wsl ? context.wslDistro : undefined;
						entry.wslUser = summary.wsl ? context.wslUser : undefined;
						entry.importedSourceId = importedSourceId;
						entry.status = "active";
						entry.updatedAt = summary.updatedAt;
						changed = true;
					}
				}
				summaryById.set(entry.id, summary);
			}

			const records = entries
				.filter((entry) => entry.projectId === projectId)
				.map((entry) => this.recordFromEntry(entry, summaryById.get(entry.id)));
			const idByPath = new Map<string, string>();
			for (const record of records) {
				if (!record.filePath) continue;
				idByPath.set(
					canonicalizeSessionPath(record.filePath, record.environment),
					record.id,
				);
			}
			for (const record of records) {
				if (!record.parentSessionPath) continue;
				record.parentSessionId = idByPath.get(
					canonicalizeSessionPath(record.parentSessionPath, record.environment),
				);
			}
			return {
				value: records.sort((left, right) => right.updatedAt - left.updatedAt),
				changed,
			};
		});
	}

	private recordFromEntry(
		entry: SessionCatalogEntry,
		summary?: SessionSummary,
	): SessionRecord {
		return {
			id: entry.id,
			projectId: entry.projectId,
			title: summary?.name || entry.title,
			source: summary?.source ?? entry.source,
			environment: summary ? getSessionEnvironment(summary) : entry.environment,
			filePath: summary?.filePath ?? entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: summary
				? getImportedSessionSourceId(summary)
				: entry.importedSourceId,
			parentSessionPath: summary?.parentSessionPath,
			projectPath: summary?.projectPath,
			preview: summary?.preview ?? "",
			messageCount: summary?.messageCount ?? 0,
			status: entry.status,
			model: entry.model ? { ...entry.model } : undefined,
			thinkingLevel: entry.thinkingLevel,
			createdAt: entry.createdAt,
			updatedAt: summary?.updatedAt ?? entry.updatedAt,
			wsl: summary?.wsl,
			codexSessionId: summary?.codexSessionId,
			codexThreadSource: summary?.codexThreadSource,
			codexParentThreadId: summary?.codexParentThreadId,
			codexAgentRole: summary?.codexAgentRole,
			codexAgentNickname: summary?.codexAgentNickname,
		};
	}

	private originKeyForEntry(entry: SessionCatalogEntry): string | undefined {
		if (!entry.filePath) return undefined;
		return buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro ?? this.identityContext.wslDistro,
			wslUser: entry.wslUser ?? this.identityContext.wslUser,
			importedSourceId: entry.importedSourceId,
		});
	}

	private requireEntry(
		entries: SessionCatalogEntry[],
		id: string,
	): SessionCatalogEntry {
		const entry = entries.find((candidate) => candidate.id === id);
		if (!entry) throw new Error(`Session not found: ${id}`);
		return entry;
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new Error("SessionCatalog.load() must complete before use");
	}

	private enqueueMutation<T>(
		mutate: (entries: SessionCatalogEntry[]) => { value: T; changed: boolean },
	): Promise<T> {
		const operation = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				const nextEntries = this.entries.map(cloneEntry);
				const result = mutate(nextEntries);
				if (result.changed) {
					await this.writeSnapshot(nextEntries);
					this.entries = nextEntries;
				}
				return result.value;
			});
		this.writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private backupFilePath(): string {
		return `${this.filePath}.bak`;
	}

	private async readEntries(filePath: string): Promise<SessionCatalogEntry[]> {
		const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<SessionCatalogFile>;
		if (!Array.isArray(parsed.sessions)) {
			throw new Error(`Invalid Session catalog: ${filePath}`);
		}
		const entries = parsed.sessions.filter((entry): entry is SessionCatalogEntry => (
			typeof entry?.id === "string" &&
			typeof entry.projectId === "string" &&
			typeof entry.title === "string" &&
			(entry.environment === "native" || entry.environment === "wsl") &&
			(entry.status === "draft" || entry.status === "active")
		));
		if (entries.length !== parsed.sessions.length) {
			throw new Error(`Session catalog contains invalid records: ${filePath}`);
		}
		return entries.map(cloneEntry);
	}

	private async writeSnapshot(entries: SessionCatalogEntry[]): Promise<void> {
		const snapshot: SessionCatalogFile = {
			version: 1,
			sessions: entries.map(cloneEntry),
		};
		await mkdir(dirname(this.filePath), { recursive: true });
		const nonce = randomUUID();
		const tempPath = `${this.filePath}.${nonce}.tmp`;
		const backupPath = this.backupFilePath();
		const backupTempPath = `${backupPath}.${nonce}.tmp`;
		try {
			const handle = await open(tempPath, "w");
			try {
				await handle.writeFile(JSON.stringify(snapshot, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}

			if (!this.skipNextBackup) {
				try {
					await copyFile(this.filePath, backupTempPath);
					await rename(backupTempPath, backupPath);
				} catch (error) {
					await unlink(backupTempPath).catch(() => undefined);
					if (!isMissingFileError(error)) throw error;
				}
			}
			await rename(tempPath, this.filePath);
			this.skipNextBackup = false;
		} finally {
			await unlink(tempPath).catch(() => undefined);
			await unlink(backupTempPath).catch(() => undefined);
		}
	}
}

export function didSessionPreferencesChange(
	entry: SessionCatalogEntry,
	patch: Pick<SessionCatalogEntry, "model" | "thinkingLevel">,
): boolean {
	return !equalModel(entry.model, patch.model) || entry.thinkingLevel !== patch.thinkingLevel;
}
