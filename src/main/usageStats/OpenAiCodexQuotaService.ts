import type { ConfigManager, PiAuthFile } from "../config/ConfigManager";
import type {
	OpenAiCodexQuotaReason,
	OpenAiCodexQuotaResult,
	OpenAiCodexQuotaSnapshot,
} from "../../shared/types/usageStats";
import { parseOpenAiCodexQuota } from "./openAiCodexQuota";

const QUOTA_URL = "https://chatgpt.com/backend-api/wham/usage";
const TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

type QuotaResponse = {
	ok: boolean;
	status: number;
	headers?: { get(name: string): string | null };
	body?: ReadableStream<Uint8Array> | null;
	text(): Promise<string>;
};

export type OpenAiCodexQuotaTransport = (
	url: string,
	init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<QuotaResponse>;

type AuthCredentials = { access: string; accountId: string; expiresAt: number | null };

type Logger = {
	info?: (message: string) => void;
	warn?: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExpiry(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	const numberValue = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
	return numberValue < 1_000_000_000_000 ? numberValue * 1000 : numberValue;
}

function readCredentials(auth: PiAuthFile): AuthCredentials | null {
	const item: unknown = auth["openai-codex"];
	if (!isRecord(item)) return null;
	if (item.type !== "oauth" || typeof item.access !== "string" || !item.access.trim() || typeof item.accountId !== "string" || !item.accountId.trim()) {
		return null;
	}
	return {
		access: item.access.trim(),
		accountId: item.accountId.trim(),
		expiresAt: parseExpiry(item.expires),
	};
}

function isExpired(credentials: AuthCredentials, now = Date.now()): boolean {
	return credentials.expiresAt !== null && credentials.expiresAt <= now;
}

function safeReasonFromStatus(status: number): OpenAiCodexQuotaReason {
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	return "network";
}

function errorResult(snapshot: OpenAiCodexQuotaSnapshot | null, reason: OpenAiCodexQuotaReason): OpenAiCodexQuotaResult {
	return snapshot
		? { status: "stale", snapshot, reason }
		: { status: "unavailable", snapshot: null, reason };
}

async function readCappedBody(response: QuotaResponse): Promise<string | null> {
	const contentLength = Number(response.headers?.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;

	// Electron Response exposes a Web ReadableStream. Read it incrementally so an unexpected
	// upstream body cannot make the main process allocate an unbounded string before validation.
	if (response.body) {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				if (!chunk.value) continue;
				totalBytes += chunk.value.byteLength;
				if (totalBytes > MAX_BODY_BYTES) {
					await reader.cancel();
					return null;
				}
				chunks.push(chunk.value);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return new TextDecoder().decode(bytes);
	}

	const body = await response.text();
	return new TextEncoder().encode(body).byteLength <= MAX_BODY_BYTES ? body : null;
}

/** 读取 pi 当前 openai-codex OAuth 身份并查询 ChatGPT 配额；不消费 refresh token。 */
export class OpenAiCodexQuotaService {
	/** Account-scoped only; credentials and account IDs never leave main-process memory. */
	private readonly cacheByAccount = new Map<string, {
		snapshot: OpenAiCodexQuotaSnapshot;
		cachedAt: number;
	}>();
	private readonly inFlightByAccount = new Map<string, Promise<OpenAiCodexQuotaResult>>();

	constructor(
		private readonly configManager: Pick<ConfigManager, "getAuthConfig">,
		private readonly transport: OpenAiCodexQuotaTransport,
		private readonly logger?: Logger,
		private readonly now: () => number = Date.now,
	) {}

	async get(options?: { force?: boolean }): Promise<OpenAiCodexQuotaResult> {
		const authResult = await this.configManager.getAuthConfig();
		if (authResult.diagnostic) return errorResult(null, "not-configured");
		const credentials = readCredentials(authResult.parsed);
		if (!credentials) return errorResult(null, "not-configured");

		const cached = this.cacheByAccount.get(credentials.accountId);
		if (isExpired(credentials, this.now())) {
			return errorResult(cached?.snapshot ?? null, "expired");
		}
		const currentRequest = this.inFlightByAccount.get(credentials.accountId);
		if (currentRequest) return currentRequest;
		if (!options?.force && cached && this.now() - cached.cachedAt < TTL_MS) {
			return { status: "ready", snapshot: cached.snapshot };
		}

		const request = this.fetchQuota(credentials).finally(() => {
			if (this.inFlightByAccount.get(credentials.accountId) === request) {
				this.inFlightByAccount.delete(credentials.accountId);
			}
		});
		this.inFlightByAccount.set(credentials.accountId, request);
		return request;
	}

	private async fetchQuota(initial: AuthCredentials): Promise<OpenAiCodexQuotaResult> {
		const first = await this.request(initial);
		if (first.status !== "unauthorized") return first.result;

		// pi may have refreshed auth.json concurrently. Re-read once and retry only when identity changed.
		const latestAuth = await this.configManager.getAuthConfig();
		const latest = latestAuth.diagnostic ? null : readCredentials(latestAuth.parsed);
		if (!latest || (latest.access === initial.access && latest.accountId === initial.accountId) || isExpired(latest, this.now())) {
			return first.result;
		}
		const retry = await this.request(latest);
		return retry.result;
	}

	private async request(credentials: AuthCredentials): Promise<{ status: number | "unauthorized"; result: OpenAiCodexQuotaResult }> {
		const cachedSnapshot = this.cacheByAccount.get(credentials.accountId)?.snapshot ?? null;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await this.transport(QUOTA_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${credentials.access}`,
					"ChatGPT-Account-ID": credentials.accountId,
				},
				signal: controller.signal,
			});
			if (!response.ok) {
				const reason = safeReasonFromStatus(response.status);
				this.logger?.warn?.(`[usage-stats] Codex quota request failed (${response.status})`);
				return { status: response.status === 401 ? "unauthorized" : response.status, result: errorResult(cachedSnapshot, reason) };
			}
			const body = await readCappedBody(response);
			if (body === null) return { status: 0, result: errorResult(cachedSnapshot, "invalid-response") };
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				return { status: 0, result: errorResult(cachedSnapshot, "invalid-response") };
			}
			const snapshot = parseOpenAiCodexQuota(parsed, this.now());
			if (!snapshot) return { status: 0, result: errorResult(cachedSnapshot, "invalid-response") };
			this.cacheByAccount.set(credentials.accountId, { snapshot, cachedAt: this.now() });
			return { status: 0, result: { status: "ready", snapshot } };
		} catch (error) {
			this.logger?.warn?.(`[usage-stats] Codex quota network failure (${error instanceof Error ? error.name : "unknown"})`);
			return { status: 0, result: errorResult(cachedSnapshot, "network") };
		} finally {
			clearTimeout(timeout);
		}
	}
}

export const openAiCodexQuotaConstants = {
	quotaUrl: QUOTA_URL,
	ttlMs: TTL_MS,
	requestTimeoutMs: REQUEST_TIMEOUT_MS,
};
