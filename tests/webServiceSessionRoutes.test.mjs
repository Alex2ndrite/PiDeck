import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function loadWebServiceManager() {
	return loadTsCommonJs("src/main/web/WebServiceManager.ts").WebServiceManager;
}

function loadBrowserApi(fetchImpl) {
	const source = readFileSync("src/renderer/src/browserApi.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = {
		exports: {},
		fetch: fetchImpl,
		URLSearchParams,
		crypto: globalThis.crypto,
		window: {
			setInterval: () => 1,
			clearInterval: () => undefined,
		},
		require: (specifier) => {
			if (specifier === "./i18n") return { t: (key) => key };
			if (specifier === "./previewApi") {
				return {
					createPreviewApi: () => ({
						projects: { list: async () => [] },
						sessions: { list: async () => [] },
						settings: { get: async () => ({ webServiceEnabled: false }) },
					}),
				};
			}
			throw new Error(`Unexpected browser API dependency: ${specifier}`);
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "browserApi.ts" });
	return sandbox.exports.createBrowserApi;
}

function fixture(overrides = {}) {
	const session = {
		id: "session-1",
		projectId: "project-1",
		title: "Session 1",
		source: "pi",
		environment: "native",
		preview: "",
		messageCount: 0,
		status: "draft",
		createdAt: 1,
		updatedAt: 1,
	};
	const runtime = {
		sessionId: session.id,
		agentId: "agent-1",
		runtimeGeneration: 3,
		projectId: session.projectId,
		cwd: "C:/project",
		status: "idle",
		createdAt: 2,
	};
	const agent = {
		id: runtime.agentId,
		projectId: session.projectId,
		cwd: runtime.cwd,
		title: session.title,
		status: "idle",
		createdAt: 2,
	};
	const calls = { createDraft: 0, createAgent: 0, send: [], stateTargets: [], messageSessions: [] };
	const targeted = (target, value) => ({ ok: true, value: { target, value } });
	const deps = {
		listProjects: () => [{ id: "project-1", name: "Project", path: "C:/project" }],
		listAgents: () => [agent],
		listSessions: async () => [],
		getSessionRuntimeMessages: (sessionId) => {
			calls.messageSessions.push(sessionId);
			return { target: runtime, value: [{ id: "m1", role: "assistant", text: "ready", timestamp: 1 }] };
		},
		listCatalogSessions: async () => [session],
		createSessionDraft: async (input) => {
			calls.createDraft += 1;
			return { ...session, projectId: input.projectId, title: input.title || session.title };
		},
		updateSessionRecord: async (_sessionId, patch) => ({ ...session, ...patch }),
		deleteSessionRecord: async () => true,
		copySessionRecord: async () => ({ cancelled: false, targetSessionId: "session-2" }),
		exportSessionRecordHtml: async () => ({ path: "session.html" }),
		readSessionReferenceMessages: async () => [
			{ role: "user", content: "reference", timestamp: 1 },
		],
		readSessionMessages: async () => [],
		readSessionMessagePage: async () => ({ messages: [], total: 0, nextBefore: null }),
		sendSessionPrompt: async (input) => {
			calls.send.push(input);
			return {
				accepted: true,
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: runtime.agentId,
				runtimeGeneration: runtime.runtimeGeneration,
			};
		},
		listSessionRuntimes: () => [runtime],
		stopSessionRuntime: async (target) => ({ ok: true, value: target }),
		abortSessionRuntime: async (target) => targeted(target, undefined),
		restartSessionRuntime: async () => ({ ok: false, error: { code: "SESSION_RUNTIME_CHANGED" } }),
		compactSessionRuntime: async (target) => targeted(target, { isStreaming: false }),
		getSessionRuntimeState: async (target) => {
			calls.stateTargets.push(target);
			return targeted(target, { isStreaming: false });
		},
		listSessionRuntimeCommands: async (target) => targeted(target, []),
		exportSessionRuntimeHtml: async (target) => targeted(target, { path: "export.html" }),
		editSessionRuntimeMessage: async (target) => targeted(target, undefined),
		deleteSessionRuntimeMessage: async (target) => targeted(target, undefined),
		prepareSessionRuntimeResend: async (target) => targeted(target, { text: "hello" }),
		setSessionRuntimeModel: async (target) => targeted(target, { isStreaming: false }),
		setSessionRuntimeThinking: async (target) => targeted(target, { isStreaming: false }),
		cloneSessionRuntime: async () => ({ ok: true, value: { targetSessionId: "session-2" } }),
		createAgent: async () => {
			calls.createAgent += 1;
			return agent;
		},
		sendPrompt: async () => ({ accepted: true }),
		stopAgent: async () => undefined,
		runtimeState: async () => ({ isStreaming: false }),
		cycleModel: async () => ({ isStreaming: false }),
		availableModels: async () => [],
		setModel: async () => ({ isStreaming: false }),
		refreshModels: async () => ({ isStreaming: false }),
		cycleThinking: async () => ({ isStreaming: false }),
		setThinking: async () => ({ isStreaming: false }),
		...overrides,
	};
	return { session, runtime, calls, deps };
}

async function withServer(run, overrides = {}) {
	const WebServiceManager = loadWebServiceManager();
	const harness = fixture(overrides);
	const manager = new WebServiceManager(harness.deps);
	await manager.start("127.0.0.1", 0);
	const baseUrl = `http://127.0.0.1:${manager.current.port}`;
	try {
		await run({ ...harness, baseUrl });
	} finally {
		await manager.stop();
	}
}

test("native Session HTTP routes create drafts and send by stable Session identity", async () => {
	await withServer(async ({ baseUrl, calls }) => {
		const createResponse = await fetch(`${baseUrl}/api/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ projectId: "project-1", title: "From web" }),
		});
		const created = await createResponse.json();
		assert.equal(created.session.id, "session-1");
		assert.equal(created.session.title, "From web");
		assert.equal(calls.createDraft, 1);
		assert.equal(calls.createAgent, 0, "native Session creation must not use the legacy Agent facade");

		const promptResponse = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ requestId: "request-1", message: " hello " }),
		});
		const prompted = await promptResponse.json();
		assert.equal(prompted.result.accepted, true);
		assert.equal(prompted.result.sessionId, "session-1");
		assert.equal(calls.send.length, 1);
		assert.equal(calls.send[0].message, "hello");
	});
});

test("runtime HTTP commands preserve the full generation-validated target", async () => {
	await withServer(async ({ baseUrl, runtime, calls }) => {
		const target = {
			sessionId: runtime.sessionId,
			agentId: runtime.agentId,
			runtimeGeneration: runtime.runtimeGeneration,
		};
		const response = await fetch(`${baseUrl}/api/sessions/session-1/runtime/state`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target }),
		});
		const body = await response.json();
		assert.equal(body.result.ok, true);
		assert.equal(JSON.stringify(calls.stateTargets), JSON.stringify([target]));

		const mismatch = await fetch(`${baseUrl}/api/sessions/other/runtime/state`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target }),
		});
		assert.equal(mismatch.status, 400);
	});
});

test("catalog Session file operations are addressed only by stable Session ID", async () => {
	await withServer(async ({ baseUrl }) => {
		const copied = await (await fetch(`${baseUrl}/api/sessions/session-1/copy`, {
			method: "POST",
			body: "{}",
		})).json();
		assert.equal(copied.result.targetSessionId, "session-2");

		const exported = await (await fetch(`${baseUrl}/api/sessions/session-1/export-html`, {
			method: "POST",
			body: "{}",
		})).json();
		assert.equal(exported.result.path, "session.html");

		const references = await (
			await fetch(`${baseUrl}/api/sessions/session-1/reference-messages`)
		).json();
		assert.equal(references.messages[0].content, "reference");
	});
});

test("historical message pages stay Session-addressed and bounded", async () => {
	await withServer(async ({ baseUrl }) => {
		const page = await (await fetch(`${baseUrl}/api/sessions/session-1/messages/page?before=3&pageSize=2`)).json();
		assert.equal(page.total, 3);
		assert.equal(page.nextBefore, 1);
	}, {
		readSessionMessagePage: async (sessionId, before, pageSize) => ({
			messages: [{ id: sessionId, role: "assistant", text: String(pageSize), timestamp: 1 }],
			total: 3,
			nextBefore: before === 3 ? 1 : null,
		}),
	});
});

test("web polling state includes Session records, runtimes, and Session-keyed messages", async () => {
	await withServer(async ({ baseUrl, calls }) => {
		const response = await fetch(`${baseUrl}/api/state`);
		const state = await response.json();
		assert.equal(state.sessions[0].id, "session-1");
		assert.equal(state.runtimes[0].runtimeGeneration, 3);
		assert.equal(state.messagesBySession["session-1"][0].text, "ready");
		assert.deepEqual(calls.messageSessions, ["session-1"]);
	});
});

test("the browser client accepts the real Session-first web-state contract", async () => {
	await withServer(async ({ baseUrl }) => {
		const createBrowserApi = loadBrowserApi((path, init) =>
			fetch(new URL(path, baseUrl), init),
		);
		const api = createBrowserApi();
		const events = [];
		const unsubscribe = api.sessions.onRuntimeEvent((event) => events.push(event));
		try {
			const projects = await api.projects.list();
			assert.equal(projects[0].id, "project-1");
			await new Promise((resolve) => setImmediate(resolve));

			const runtimeEvent = events.find((event) => event.sourceChannel === "sessions:runtime");
			assert.equal(runtimeEvent?.sessionId, "session-1");
			assert.equal(runtimeEvent?.payload.status, "idle");
			const messageEvent = events.find((event) => event.sourceChannel === "sessions:messages");
			assert.equal(messageEvent?.payload.messages[0].text, "ready");
		} finally {
			unsubscribe();
		}
	});
});

test("web polling omits a message snapshot whose runtime target no longer matches", async () => {
	await withServer(async ({ baseUrl }) => {
		const response = await fetch(`${baseUrl}/api/state`);
		const state = await response.json();
		assert.equal(state.runtimes[0].agentId, "agent-1");
		assert.equal("session-1" in state.messagesBySession, false);
	}, {
		getSessionRuntimeMessages: () => ({
			target: { sessionId: "session-1", agentId: "agent-2", runtimeGeneration: 4 },
			value: [{ id: "stale", role: "assistant", text: "stale", timestamp: 1 }],
		}),
	});
});

test("web polling cannot read runtime messages directly by Agent ID", () => {
	const source = readFileSync("src/main/web/WebServiceManager.ts", "utf8");
	assert.match(source, /getSessionRuntimeMessages\(runtime\.sessionId\)/);
	assert.doesNotMatch(source, /getMessages\(runtime\.agentId\)/);
});

test("embedded web client and HTTP surface are Session-first", async () => {
	await withServer(async ({ baseUrl }) => {
		const page = await (await fetch(baseUrl)).text();
		assert.match(page, /navigator\.languages/);
		assert.match(page, /localizeDescriptor/);
		assert.match(page, /activeSessionId/);
		assert.match(page, /runtimeGeneration/);
		assert.match(page, /\/api\/sessions\//);
		assert.doesNotMatch(page, /\/api\/agents/);
		assert.doesNotMatch(page, /activeAgentId|messagesByAgent|data-agent/);

		const legacy = await fetch(`${baseUrl}/api/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ projectId: "project-1" }),
		});
		assert.equal(legacy.status, 404);
		assert.equal((await legacy.json()).code, "webError.apiNotFound");
	});
});

test("web errors expose stable codes without leaking unknown server exceptions", async () => {
	await withServer(async ({ baseUrl, runtime }) => {
		const mismatch = await fetch(`${baseUrl}/api/sessions/other/runtime/state`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target: runtime }),
		});
		const body = await mismatch.json();
		assert.equal(mismatch.status, 400);
		assert.equal(body.code, "webError.runtimeTargetRequired");
		assert.equal("debugDetails" in body, false);
	});

	await withServer(async ({ baseUrl }) => {
		const response = await fetch(`${baseUrl}/api/state`);
		const body = await response.json();
		assert.equal(response.status, 500);
		assert.equal(body.code, "webError.internal");
		assert.equal(body.error, "The web service encountered an internal error");
		assert.equal("debugDetails" in body, false);
		assert.doesNotMatch(JSON.stringify(body), /SECRET_STACK_DETAIL/);
	}, {
		listProjects: () => {
			throw new Error("SECRET_STACK_DETAIL");
		},
	});
});

test("web responses strip desktop diagnostics and raw prompt errors recursively", async () => {
	await withServer(async ({ baseUrl, runtime }) => {
		const state = await (await fetch(`${baseUrl}/api/state`)).json();
		const serializedState = JSON.stringify(state);
		assert.doesNotMatch(serializedState, /SECRET_MESSAGE_DIAGNOSTIC/);
		assert.equal(
			"debugDetails" in state.messagesBySession["session-1"][0].meta,
			false,
		);

		const prompt = await (await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ requestId: "request-raw-error", message: "hello" }),
		})).json();
		assert.equal(prompt.result.error, "Failed to send the message.");
		assert.equal("debugDetails" in prompt.result, false);
		assert.doesNotMatch(JSON.stringify(prompt), /SECRET_PROMPT_ERROR/);

		const command = await (await fetch(`${baseUrl}/api/sessions/session-1/runtime/state`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target: runtime }),
		})).json();
		assert.equal(command.result.error.code, "SESSION_COMMAND_FAILED");
		assert.equal("debugDetails" in command.result.error, false);
		assert.doesNotMatch(JSON.stringify(command), /SECRET_COMMAND_STACK/);
	}, {
		getSessionRuntimeMessages: (_sessionId) => ({
			target: {
				sessionId: "session-1",
				agentId: "agent-1",
				runtimeGeneration: 3,
			},
			value: [{
				id: "m-secret",
				agentId: "agent-1",
				role: "error",
				text: "Request failed.",
				timestamp: 1,
				meta: {
					i18nKey: "diagnostic.requestFailedUnknown",
					debugDetails: "SECRET_MESSAGE_DIAGNOSTIC",
				},
			}],
		}),
		sendSessionPrompt: async (input) => ({
			accepted: false,
			sessionId: input.sessionId,
			requestId: input.requestId,
			error: "SECRET_PROMPT_ERROR",
			i18nKey: "diagnostic.promptRejected",
			debugDetails: "SECRET_PROMPT_STACK",
		}),
		getSessionRuntimeState: async () => ({
			ok: false,
			error: {
				code: "SESSION_COMMAND_FAILED",
				debugDetails: "SECRET_COMMAND_STACK",
			},
		}),
	});
});
