import type {
	AgentTab,
	CreateAgentInput,
	SendPromptInput,
	SendPromptResult,
	SendSessionPromptInput,
	SendSessionPromptResult,
	SessionRecord,
	SessionRuntimeEvent,
	SessionUiResponseInput,
} from "../../shared/types";
import { buildSessionOriginKey } from "../../shared/sessionIdentity";
import type { SessionCatalogEntry } from "./SessionCatalog";

export interface SessionCatalogGateway {
	get(sessionId: string): SessionCatalogEntry | undefined;
	attachRuntime(input: {
		sessionId: string;
		filePath?: string;
		piSessionId?: string;
		title?: string;
	}): Promise<unknown>;
}

export interface SessionAgentGateway {
	list(): AgentTab[];
	create(input: CreateAgentInput): Promise<AgentTab>;
	restart(agentId: string): Promise<AgentTab>;
	stop(agentId: string): Promise<void>;
	setModel(agentId: string, provider: string, modelId: string): Promise<unknown>;
	setThinking(agentId: string, level: string): Promise<unknown>;
	sendUIResponse(
		agentId: string,
		requestId: string,
		response: SessionUiResponseInput["response"],
	): Promise<unknown> | unknown;
}

type DeliveryCacheEntry = {
	createdAt: number;
	settled: boolean;
	promise: Promise<SendSessionPromptResult>;
};

type PendingUiRequest = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
	requestId: string;
};

const DELIVERY_CACHE_TTL_MS = 10 * 60_000;
const DELIVERY_CACHE_MAX_ENTRIES = 500;
const AGENT_READY_TIMEOUT_MS = 60_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isTerminalAgent(tab: AgentTab): boolean {
	return tab.status === "error" || tab.status === "closed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteractiveUiMethod(method: unknown): boolean {
	return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

export class SessionRuntimeCoordinator {
	private readonly activationBySession = new Map<string, Promise<AgentTab>>();
	private readonly deliveryByRequest = new Map<string, DeliveryCacheEntry>();
	private readonly agentIdBySession = new Map<string, string>();
	private readonly sessionIdByAgent = new Map<string, string>();
	private readonly generationBySession = new Map<string, number>();
	private readonly pendingUiRequests = new Map<string, PendingUiRequest>();

	constructor(
		private readonly catalog: SessionCatalogGateway,
		private readonly agents: SessionAgentGateway,
		private readonly sendAgentPrompt: (input: SendPromptInput) => Promise<SendPromptResult>,
	) {}

	send(input: SendSessionPromptInput): Promise<SendSessionPromptResult> {
		const sessionId = input.sessionId.trim();
		const requestId = input.requestId.trim();
		if (!sessionId) return Promise.resolve(this.rejected(input, "Session ID is required"));
		if (!requestId) return Promise.resolve(this.rejected(input, "Request ID is required"));
		if (!input.message.trim() && !input.images?.length) {
			return Promise.resolve(this.rejected(input, "消息不能为空"));
		}

		this.pruneDeliveryCache();
		const cacheKey = `${sessionId}\u0000${requestId}`;
		const existing = this.deliveryByRequest.get(cacheKey);
		if (existing) return existing.promise;

		const cacheEntry: DeliveryCacheEntry = {
			createdAt: Date.now(),
			settled: false,
			promise: Promise.resolve(this.rejected(input, "Request was not started")),
		};
		cacheEntry.promise = this.sendOnce({ ...input, sessionId, requestId })
			.finally(() => {
				cacheEntry.settled = true;
			});
		this.deliveryByRequest.set(cacheKey, cacheEntry);
		return cacheEntry.promise;
	}

	getAgentId(sessionId: string): string | undefined {
		const agentId = this.agentIdBySession.get(sessionId);
		if (!agentId) return undefined;
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (tab && !isTerminalAgent(tab)) return agentId;
		this.unbindAgent(agentId);
		return undefined;
	}

	getSessionId(agentId: string): string | undefined {
		return this.sessionIdByAgent.get(agentId);
	}

	bindExistingAgent(sessionId: string, agentId: string): number {
		if (!this.catalog.get(sessionId)) throw new Error(`Session not found: ${sessionId}`);
		return this.bind(sessionId, agentId);
	}

	attachCatalogRuntimes(records: SessionRecord[]): Array<{
		sessionId: string;
		agentId: string;
		runtimeGeneration: number;
	}> {
		const bindings: Array<{
			sessionId: string;
			agentId: string;
			runtimeGeneration: number;
		}> = [];
		const availableAgents = this.agents.list().filter((tab) => !isTerminalAgent(tab));
		for (const record of records) {
			if (!record.filePath) continue;
			const target = buildSessionOriginKey({
				source: record.source,
				environment: record.environment,
				filePath: record.filePath,
				wslDistro: record.wslDistro,
				wslUser: record.wslUser,
				importedSourceId: record.importedSourceId,
			});
			const tab = availableAgents.find((candidate) => (
				candidate.projectId === record.projectId &&
				candidate.sessionPath &&
				buildSessionOriginKey({
					source: candidate.sessionSource ?? "pi",
					environment: candidate.sessionEnvironment ?? "native",
					filePath: candidate.sessionPath,
					wslDistro: candidate.wslDistro,
					wslUser: candidate.wslUser,
					importedSourceId: candidate.importedSourceId,
				}) === target
			));
			if (!tab) continue;
			bindings.push({
				sessionId: record.id,
				agentId: tab.id,
				runtimeGeneration: this.bind(record.id, tab.id),
			});
		}
		return bindings;
	}

	observeRuntimeEvent(event: SessionRuntimeEvent): void {
		const binding = this.getRuntimeBinding(event.agentId);
		if (
			!binding ||
			binding.sessionId !== event.sessionId ||
			binding.runtimeGeneration !== event.runtimeGeneration ||
			event.sourceChannel !== "agents:ui-request" ||
			!isRecord(event.payload)
		) {
			return;
		}
		const requestId = typeof event.payload.requestId === "string"
			? event.payload.requestId.trim()
			: "";
		if (!requestId) return;
		const key = this.uiRequestKey(event.sessionId, requestId);
		if (event.payload.completed === true) {
			this.pendingUiRequests.delete(key);
			return;
		}
		if (!isInteractiveUiMethod(event.payload.method)) return;
		this.pendingUiRequests.set(key, {
			sessionId: event.sessionId,
			agentId: event.agentId,
			runtimeGeneration: event.runtimeGeneration,
			requestId,
		});
	}

	async respondToUi(input: SessionUiResponseInput): Promise<void> {
		const binding = this.getRuntimeBinding(input.agentId);
		if (
			!binding ||
			binding.sessionId !== input.sessionId ||
			binding.runtimeGeneration !== input.runtimeGeneration ||
			this.agentIdBySession.get(input.sessionId) !== input.agentId
		) {
			throw new Error("Session runtime binding changed before UI response");
		}
		const key = this.uiRequestKey(input.sessionId, input.requestId);
		const pending = this.pendingUiRequests.get(key);
		if (
			!pending ||
			pending.agentId !== input.agentId ||
			pending.runtimeGeneration !== input.runtimeGeneration
		) {
			throw new Error("Session UI request is not pending");
		}
		this.pendingUiRequests.delete(key);
		try {
			await this.agents.sendUIResponse(input.agentId, input.requestId, input.response);
		} catch (error) {
			this.pendingUiRequests.set(key, pending);
			throw error;
		}
	}

	getRuntimeBinding(agentId: string): {
		sessionId: string;
		runtimeGeneration: number;
	} | undefined {
		const sessionId = this.sessionIdByAgent.get(agentId);
		if (!sessionId || this.agentIdBySession.get(sessionId) !== agentId) return undefined;
		return {
			sessionId,
			runtimeGeneration: this.generationBySession.get(sessionId) ?? 0,
		};
	}

	unbindAgent(agentId: string): void {
		const sessionId = this.sessionIdByAgent.get(agentId);
		if (sessionId) {
			this.agentIdBySession.delete(sessionId);
			this.clearPendingUiRequests(sessionId, agentId);
		}
		this.sessionIdByAgent.delete(agentId);
	}

	async restartSession(sessionId: string, agentId: string): Promise<AgentTab> {
		const entry = this.catalog.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		const mappedAgentId = this.getAgentId(sessionId);
		if (mappedAgentId && mappedAgentId !== agentId) {
			throw new Error("Session runtime changed before restart");
		}

		let tab = await this.agents.restart(agentId);
		if (tab.status === "starting") tab = await this.waitUntilReady(tab);
		if (isTerminalAgent(tab)) {
			this.unbindAgent(agentId);
			throw new Error(`Failed to restart session runtime (${tab.status})`);
		}
		try {
			await this.applyPreferences(entry, tab.id);
		} catch (error) {
			await this.agents.stop(tab.id).catch(() => undefined);
			this.unbindAgent(agentId);
			throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
		}

		const runtimeGeneration = this.bind(sessionId, tab.id);
		tab.runtimeGeneration = runtimeGeneration;
		if (tab.sessionPath) {
			await this.catalog.attachRuntime({
				sessionId,
				filePath: tab.sessionPath,
				piSessionId: tab.sessionId,
				title: tab.title,
			});
		}
		return tab;
	}

	private async sendOnce(input: SendSessionPromptInput): Promise<SendSessionPromptResult> {
		let tab: AgentTab;
		try {
			tab = await this.ensureRuntime(input.sessionId);
		} catch (error) {
			return this.rejected(input, errorMessage(error));
		}

		let result: SendPromptResult;
		try {
			result = await this.sendAgentPrompt({
				agentId: tab.id,
				message: input.message,
				images: input.images,
				streamingBehavior: input.streamingBehavior,
				agentMessage: input.agentMessage,
				description: input.description,
			});
		} catch (error) {
			result = {
				accepted: false,
				error: errorMessage(error),
				delivery: "unknown",
			};
		}

		const currentTab = this.agents.list().find((candidate) => candidate.id === tab.id) ?? tab;
		if (currentTab.sessionPath) {
			await this.catalog.attachRuntime({
				sessionId: input.sessionId,
				filePath: currentTab.sessionPath,
				piSessionId: currentTab.sessionId,
				title: currentTab.title,
			}).catch(() => undefined);
		}
		return {
			...result,
			sessionId: input.sessionId,
			requestId: input.requestId,
			agentId: tab.id,
			sessionPath: currentTab.sessionPath,
			runtimeGeneration: currentTab.runtimeGeneration,
		};
	}

	private ensureRuntime(sessionId: string): Promise<AgentTab> {
		const existing = this.activationBySession.get(sessionId);
		if (existing) return existing;
		const activation = this.activate(sessionId).finally(() => {
			this.activationBySession.delete(sessionId);
		});
		this.activationBySession.set(sessionId, activation);
		return activation;
	}

	private async activate(sessionId: string): Promise<AgentTab> {
		const entry = this.catalog.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);

		const mappedAgentId = this.getAgentId(sessionId);
		if (mappedAgentId) {
			const mappedTab = this.agents.list().find((candidate) => candidate.id === mappedAgentId);
			if (mappedTab) return this.waitUntilReady(mappedTab);
		}

		let tab = entry.filePath ? this.findAgentBySessionPath(entry) : undefined;
		if (tab && isTerminalAgent(tab)) {
			await this.agents.stop(tab.id);
			tab = undefined;
		}
		if (tab?.status === "starting") tab = await this.waitUntilReady(tab);

		const created = !tab;
		if (!tab) {
			tab = await this.agents.create({
				projectId: entry.projectId,
				title: entry.title,
				sessionPath: entry.filePath,
				environment: entry.environment,
				source: entry.source,
				wslDistro: entry.wslDistro,
				wslUser: entry.wslUser,
				importedSourceId: entry.importedSourceId,
			});
		}
		if (tab.status === "starting") tab = await this.waitUntilReady(tab);
		if (isTerminalAgent(tab)) {
			if (created) await this.agents.stop(tab.id).catch(() => undefined);
			throw new Error(`Failed to start session runtime (${tab.status})`);
		}

		try {
			await this.applyPreferences(entry, tab.id);
		} catch (error) {
			if (created) await this.agents.stop(tab.id).catch(() => undefined);
			throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
		}

		const runtimeGeneration = this.bind(sessionId, tab.id);
		tab.runtimeGeneration = runtimeGeneration;
		if (tab.sessionPath) {
			await this.catalog.attachRuntime({
				sessionId,
				filePath: tab.sessionPath,
				piSessionId: tab.sessionId,
				title: tab.title,
			});
		}
		return tab;
	}

	private findAgentBySessionPath(entry: SessionCatalogEntry): AgentTab | undefined {
		if (!entry.filePath) return undefined;
		const target = buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: entry.importedSourceId,
		});
		return this.agents.list().find((tab) => (
			tab.sessionPath &&
			buildSessionOriginKey({
				source: tab.sessionSource ?? "pi",
				environment: tab.sessionEnvironment ?? "native",
				filePath: tab.sessionPath,
				wslDistro: tab.wslDistro,
				wslUser: tab.wslUser,
				importedSourceId: tab.importedSourceId,
			}) === target
		));
	}

	private async applyPreferences(
		entry: SessionCatalogEntry,
		agentId: string,
	): Promise<void> {
		if (entry.model) {
			await this.agents.setModel(agentId, entry.model.provider, entry.model.modelId);
		}
		if (entry.thinkingLevel) {
			await this.agents.setThinking(agentId, entry.thinkingLevel);
		}
	}

	private async waitUntilReady(initialTab: AgentTab): Promise<AgentTab> {
		const startedAt = Date.now();
		let tab = initialTab;
		while (tab.status === "starting") {
			if (Date.now() - startedAt >= AGENT_READY_TIMEOUT_MS) {
				throw new Error("Timed out while starting session runtime");
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 50));
			const current = this.agents.list().find((candidate) => candidate.id === tab.id);
			if (!current) throw new Error("Session runtime stopped while starting");
			tab = current;
		}
		if (isTerminalAgent(tab)) {
			throw new Error(`Failed to start session runtime (${tab.status})`);
		}
		return tab;
	}

	private bind(sessionId: string, agentId: string): number {
		const previousAgentId = this.agentIdBySession.get(sessionId);
		if (
			previousAgentId === agentId &&
			this.sessionIdByAgent.get(agentId) === sessionId
		) {
			return this.generationBySession.get(sessionId) ?? 0;
		}
		if (previousAgentId && previousAgentId !== agentId) {
			this.sessionIdByAgent.delete(previousAgentId);
			this.clearPendingUiRequests(sessionId, previousAgentId);
		}
		const previousSessionId = this.sessionIdByAgent.get(agentId);
		if (previousSessionId && previousSessionId !== sessionId) {
			this.agentIdBySession.delete(previousSessionId);
			this.clearPendingUiRequests(previousSessionId, agentId);
		}
		this.clearPendingUiRequests(sessionId);
		const runtimeGeneration = (this.generationBySession.get(sessionId) ?? 0) + 1;
		this.generationBySession.set(sessionId, runtimeGeneration);
		this.agentIdBySession.set(sessionId, agentId);
		this.sessionIdByAgent.set(agentId, sessionId);
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (tab) tab.runtimeGeneration = runtimeGeneration;
		return runtimeGeneration;
	}

	private uiRequestKey(sessionId: string, requestId: string): string {
		return `${sessionId}\u0000${requestId}`;
	}

	private clearPendingUiRequests(sessionId: string, agentId?: string): void {
		for (const [key, pending] of this.pendingUiRequests) {
			if (pending.sessionId === sessionId && (!agentId || pending.agentId === agentId)) {
				this.pendingUiRequests.delete(key);
			}
		}
	}

	private pruneDeliveryCache(): void {
		const now = Date.now();
		for (const [key, entry] of this.deliveryByRequest) {
			if (entry.settled && now - entry.createdAt > DELIVERY_CACHE_TTL_MS) {
				this.deliveryByRequest.delete(key);
			}
		}
		if (this.deliveryByRequest.size <= DELIVERY_CACHE_MAX_ENTRIES) return;
		for (const [key, entry] of this.deliveryByRequest) {
			if (!entry.settled) continue;
			this.deliveryByRequest.delete(key);
			if (this.deliveryByRequest.size <= DELIVERY_CACHE_MAX_ENTRIES) break;
		}
	}

	private rejected(
		input: Pick<SendSessionPromptInput, "sessionId" | "requestId">,
		error: string,
	): SendSessionPromptResult {
		return {
			accepted: false,
			delivery: "rejected",
			error,
			sessionId: input.sessionId,
			requestId: input.requestId,
		};
	}
}
