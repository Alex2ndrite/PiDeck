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

export type SessionRuntimeBinding = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
};

type RuntimeReplacement = SessionRuntimeBinding & {
	replacementId: number;
};

type DispatchLease = SessionRuntimeBinding & {
	leaseId: number;
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
	private readonly replacementByAgent = new Map<string, RuntimeReplacement>();
	private readonly replacementBySession = new Map<string, RuntimeReplacement>();
	private readonly dispatchLeasesByAgent = new Map<string, Set<DispatchLease>>();
	private readonly dispatchLeasesBySession = new Map<string, Set<DispatchLease>>();
	private replacementSequence = 0;
	private dispatchLeaseSequence = 0;

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
		const availableAgents = this.agents.list().filter((tab) => (
			!isTerminalAgent(tab) &&
			!this.replacementByAgent.has(tab.id) &&
			!this.hasDispatchLease(undefined, tab.id)
		));
		for (const record of records) {
			if (
				!record.filePath ||
				this.replacementBySession.has(record.id) ||
				this.hasDispatchLease(record.id)
			) continue;
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

	async replaceBoundRuntime<T extends { cancelled?: boolean }>(input: {
		agentId: string;
		replace: () => Promise<T>;
		resolveTargetSessionId: (result: T) => Promise<string>;
		canRestoreOrigin: () => boolean;
		onDetached: (binding: SessionRuntimeBinding) => void;
		onAttached: (binding: SessionRuntimeBinding) => void;
		onRestored: (binding: SessionRuntimeBinding) => void;
	}): Promise<T & { targetSessionId?: string }> {
		const replacement = this.beginRuntimeReplacement(input.agentId);
		if (!replacement) return input.replace();

		try {
			input.onDetached(replacement);
			const result = await input.replace();
			if (result.cancelled) {
				const restored = this.restoreRuntimeReplacement(replacement);
				input.onRestored(restored);
				return result;
			}
			const targetSessionId = await input.resolveTargetSessionId(result);
			const attached = this.completeRuntimeReplacement(replacement, targetSessionId);
			// The target binding is committed before observers run. Snapshot failures
			// must not roll the agent back onto the detached origin Session.
			input.onAttached(attached);
			return { ...result, targetSessionId };
		} catch (error) {
			if (this.replacementByAgent.get(input.agentId) === replacement) {
				let canRestoreOrigin = false;
				try {
					canRestoreOrigin = input.canRestoreOrigin();
				} catch {
					// An unprovable runtime identity is handled fail-closed.
				}
				if (canRestoreOrigin) {
					const restored = this.restoreRuntimeReplacement(replacement);
					input.onRestored(restored);
				} else {
					this.failClosedRuntimeReplacement(replacement);
				}
			}
			throw error;
		}
	}

	unbindAgent(agentId: string): void {
		this.assertNoDispatchLease(undefined, agentId);
		this.unbindAgentUnchecked(agentId);
	}

	private unbindAgentUnchecked(agentId: string): void {
		const replacement = this.replacementByAgent.get(agentId);
		if (replacement) this.releaseRuntimeReplacement(replacement);
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

		const reservation = this.reserveBoundRuntime(sessionId, agentId);
		try {
			let tab = await this.agents.restart(agentId);
			if (tab.status === "starting") tab = await this.waitUntilReady(tab);
			if (isTerminalAgent(tab)) {
				this.unbindAgentUnchecked(agentId);
				throw new Error(`Failed to restart session runtime (${tab.status})`);
			}
			try {
				await this.applyPreferences(entry, tab.id);
			} catch (error) {
				await this.agents.stop(tab.id).catch(() => undefined);
				this.unbindAgentUnchecked(agentId);
				throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
			}

			this.requireCurrentReservation(reservation);
			this.releaseRuntimeReplacement(reservation);
			this.unbindAgentUnchecked(agentId);
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
		} finally {
			if (this.replacementByAgent.get(agentId) === reservation) {
				this.releaseRuntimeReplacement(reservation);
			}
		}
	}

	private async sendOnce(input: SendSessionPromptInput): Promise<SendSessionPromptResult> {
		let tab: AgentTab;
		try {
			tab = await this.ensureRuntime(input.sessionId);
		} catch (error) {
			return this.rejected(input, errorMessage(error));
		}

		let lease: DispatchLease;
		try {
			lease = this.acquireDispatchLease(input.sessionId, tab.id);
		} catch (error) {
			return this.rejected(input, errorMessage(error));
		}

		try {
			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed before prompt dispatch");
			}

			let result: SendPromptResult;
			try {
				result = await this.sendAgentPrompt({
					agentId: lease.agentId,
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

			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed during prompt dispatch");
			}
			const currentTab = this.agents.list().find((candidate) => (
				candidate.id === lease.agentId && !isTerminalAgent(candidate)
			));
			if (!currentTab) {
				return this.unknownDelivery(input, "Session runtime stopped during prompt dispatch");
			}
			if (currentTab.sessionPath) {
				await this.catalog.attachRuntime({
					sessionId: input.sessionId,
					filePath: currentTab.sessionPath,
					piSessionId: currentTab.sessionId,
					title: currentTab.title,
				}).catch(() => undefined);
			}
			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed after prompt dispatch");
			}
			return {
				...result,
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: lease.agentId,
				sessionPath: currentTab.sessionPath,
				runtimeGeneration: lease.runtimeGeneration,
			};
		} finally {
			this.releaseDispatchLease(lease);
		}
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
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}

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
			!this.replacementByAgent.has(tab.id) &&
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
		this.assertNoDispatchLease(sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}
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

	private beginRuntimeReplacement(agentId: string): RuntimeReplacement | undefined {
		const binding = this.getRuntimeBinding(agentId);
		if (!binding) return undefined;
		this.assertNoDispatchLease(binding.sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(binding.sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${binding.sessionId}`);
		}
		const runtimeGeneration = binding.runtimeGeneration + 1;
		this.generationBySession.set(binding.sessionId, runtimeGeneration);
		this.agentIdBySession.delete(binding.sessionId);
		this.sessionIdByAgent.delete(agentId);
		this.clearPendingUiRequests(binding.sessionId, agentId);
		const replacement: RuntimeReplacement = {
			...binding,
			agentId,
			runtimeGeneration,
			replacementId: ++this.replacementSequence,
		};
		this.replacementByAgent.set(agentId, replacement);
		this.replacementBySession.set(binding.sessionId, replacement);
		return replacement;
	}

	private completeRuntimeReplacement(
		replacement: RuntimeReplacement,
		targetSessionId: string,
	): SessionRuntimeBinding {
		this.requireCurrentReplacement(replacement);
		if (!this.catalog.get(targetSessionId)) {
			throw new Error(`Session not found: ${targetSessionId}`);
		}
		const targetAgentId = this.getAgentId(targetSessionId);
		if (targetAgentId && targetAgentId !== replacement.agentId) {
			throw new Error(`Session runtime target already bound: ${targetSessionId}`);
		}
		const targetReplacement = this.replacementBySession.get(targetSessionId);
		if (targetReplacement && targetReplacement !== replacement) {
			throw new Error(`Session runtime replacement reservation conflict: ${targetSessionId}`);
		}
		this.releaseRuntimeReplacement(replacement);
		return {
			sessionId: targetSessionId,
			agentId: replacement.agentId,
			runtimeGeneration: this.bind(targetSessionId, replacement.agentId),
		};
	}

	private restoreRuntimeReplacement(
		replacement: RuntimeReplacement,
	): SessionRuntimeBinding {
		this.requireCurrentReplacement(replacement);
		this.releaseRuntimeReplacement(replacement);
		return {
			sessionId: replacement.sessionId,
			agentId: replacement.agentId,
			runtimeGeneration: this.bind(replacement.sessionId, replacement.agentId),
		};
	}

	private failClosedRuntimeReplacement(replacement: RuntimeReplacement): void {
		this.requireCurrentReplacement(replacement);
		this.releaseRuntimeReplacement(replacement);
	}

	private releaseRuntimeReplacement(replacement: RuntimeReplacement): void {
		if (this.replacementByAgent.get(replacement.agentId) === replacement) {
			this.replacementByAgent.delete(replacement.agentId);
		}
		if (this.replacementBySession.get(replacement.sessionId) === replacement) {
			this.replacementBySession.delete(replacement.sessionId);
		}
	}

	private requireCurrentReplacement(replacement: RuntimeReplacement): void {
		if (this.replacementByAgent.get(replacement.agentId) !== replacement) {
			throw new Error("Session runtime replacement binding changed");
		}
		if (this.replacementBySession.get(replacement.sessionId) !== replacement) {
			throw new Error("Session runtime replacement reservation changed");
		}
		if (
			this.sessionIdByAgent.has(replacement.agentId) ||
			this.agentIdBySession.get(replacement.sessionId) === replacement.agentId
		) {
			throw new Error("Session runtime replacement acquired a competing binding");
		}
	}

	private reserveBoundRuntime(sessionId: string, agentId: string): RuntimeReplacement {
		const binding = this.getRuntimeBinding(agentId);
		if (
			!binding ||
			binding.sessionId !== sessionId ||
			this.agentIdBySession.get(sessionId) !== agentId
		) {
			throw new Error("Session runtime changed before reservation");
		}
		this.assertNoDispatchLease(sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}
		const reservation: RuntimeReplacement = {
			...binding,
			agentId,
			replacementId: ++this.replacementSequence,
		};
		this.replacementByAgent.set(agentId, reservation);
		this.replacementBySession.set(sessionId, reservation);
		return reservation;
	}

	private requireCurrentReservation(reservation: RuntimeReplacement): void {
		if (
			this.replacementByAgent.get(reservation.agentId) !== reservation ||
			this.replacementBySession.get(reservation.sessionId) !== reservation
		) {
			throw new Error("Session runtime reservation changed");
		}
		const binding = this.getRuntimeBinding(reservation.agentId);
		if (
			!binding ||
			binding.sessionId !== reservation.sessionId ||
			binding.runtimeGeneration !== reservation.runtimeGeneration
		) {
			throw new Error("Session runtime binding changed during reservation");
		}
	}

	private acquireDispatchLease(sessionId: string, agentId: string): DispatchLease {
		if (this.replacementBySession.has(sessionId) || this.replacementByAgent.has(agentId)) {
			throw new Error("Session runtime replacement is in progress");
		}
		const binding = this.getRuntimeBinding(agentId);
		if (!binding || binding.sessionId !== sessionId) {
			throw new Error("Session runtime binding changed before prompt dispatch");
		}
		const lease: DispatchLease = {
			...binding,
			agentId,
			leaseId: ++this.dispatchLeaseSequence,
		};
		this.addDispatchLease(this.dispatchLeasesBySession, sessionId, lease);
		this.addDispatchLease(this.dispatchLeasesByAgent, agentId, lease);
		return lease;
	}

	private addDispatchLease(
		leases: Map<string, Set<DispatchLease>>,
		key: string,
		lease: DispatchLease,
	): void {
		const current = leases.get(key) ?? new Set<DispatchLease>();
		current.add(lease);
		leases.set(key, current);
	}

	private releaseDispatchLease(lease: DispatchLease): void {
		for (const [leases, key] of [
			[this.dispatchLeasesBySession, lease.sessionId],
			[this.dispatchLeasesByAgent, lease.agentId],
		] as const) {
			const current = leases.get(key);
			if (!current) continue;
			current.delete(lease);
			if (current.size === 0) leases.delete(key);
		}
	}

	private isCurrentDispatchLease(lease: DispatchLease): boolean {
		if (
			!this.dispatchLeasesBySession.get(lease.sessionId)?.has(lease) ||
			!this.dispatchLeasesByAgent.get(lease.agentId)?.has(lease)
		) return false;
		const binding = this.getRuntimeBinding(lease.agentId);
		return Boolean(
			binding &&
			binding.sessionId === lease.sessionId &&
			binding.runtimeGeneration === lease.runtimeGeneration &&
			this.agentIdBySession.get(lease.sessionId) === lease.agentId
		);
	}

	private hasDispatchLease(sessionId?: string, agentId?: string): boolean {
		return Boolean(
			(sessionId && this.dispatchLeasesBySession.get(sessionId)?.size) ||
			(agentId && this.dispatchLeasesByAgent.get(agentId)?.size)
		);
	}

	private assertNoDispatchLease(sessionId?: string, agentId?: string): void {
		if (this.hasDispatchLease(sessionId, agentId)) {
			throw new Error("Session runtime prompt dispatch is in progress");
		}
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

	private unknownDelivery(
		input: Pick<SendSessionPromptInput, "sessionId" | "requestId">,
		error: string,
	): SendSessionPromptResult {
		return {
			accepted: false,
			delivery: "unknown",
			error,
			sessionId: input.sessionId,
			requestId: input.requestId,
		};
	}
}
