import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const bridgeSource = readFileSync("src/main/feishu/FeishuBridge.ts", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");

test("FeishuBridge receives a narrow Session runtime binding gateway", () => {
	assert.match(bridgeSource, /export interface SessionRuntimeBindingGateway/);
	assert.match(bridgeSource, /private runtimeBindings: SessionRuntimeBindingGateway/);
	assert.doesNotMatch(bridgeSource, /sessionRuntimeByIdAtom|bindSessionRuntimeAtom/);
});

test("every Agent creation branch binds through the gateway after creation", () => {
	const createCalls = [...bridgeSource.matchAll(/await this\.agentManager\.create\(/g)].length;
	const bindingCalls = [...bridgeSource.matchAll(/await this\.runtimeBindings\.bindRuntime\(/g)].length;
	assert.equal(createCalls, 3);
	assert.ok(bindingCalls >= createCalls);
});

test("main injects an origin-safe catalog gateway into every Feishu bridge", () => {
	assert.match(mainSource, /const feishuSessionRuntimeBindings/);
	assert.match(mainSource, /const existing = sessionCatalog\.get\(input\.existingSessionId\)/);
	assert.match(mainSource, /if \(!canAttachRuntimeMetadata\(existing, input\.agent\)\)/);
	assert.match(mainSource, /Existing Session origin does not match runtime/);
	assert.match(mainSource, /if \(!sessionId && input\.agent\.sessionPath\)/);
	const guardIndex = mainSource.indexOf("if (!canAttachRuntimeMetadata(existing, input.agent))");
	const attachIndex = mainSource.indexOf("await sessionCatalog.attachRuntime({", guardIndex);
	assert.ok(guardIndex >= 0 && attachIndex > guardIndex, "origin guard must precede runtime metadata attachment");
	const constructors = [...mainSource.matchAll(/new FeishuBridge\(/g)].length;
	const injections = [...mainSource.matchAll(/feishuSessionRuntimeBindings/g)].length - 1;
	assert.ok(constructors >= 4);
	assert.ok(injections >= constructors);
});

function compileBridge(loadBindings = [], options = {}) {
	const output = ts.transpileModule(bridgeSource, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	const richText = { chooseMessageMode: () => "text", buildPostMessages: () => [], buildMarkdownCards: () => [] };
	const cardState = {
		createInitialState: () => ({ terminal: "running", outputText: "" }),
		reduceFromPiEvent: (state) => state,
		markInterrupted: (state) => state,
		markError: (state) => state,
		markDone: (state) => state,
	};
	const imports = {
		"electron": { app: { getPath: () => "." } },
		"../../shared/ipc": { ipcChannels: {} },
		"./FeishuConfig": {
			listBots: () => [], addBot: () => undefined, removeBot: () => false, updateBot: () => undefined,
			getDecryptedBotAppSecret: () => "", loadBindings: () => loadBindings, saveBindings: () => undefined,
			getPersistentChatId: options.getPersistentChatId ?? (() => undefined), setPersistentChatId: () => undefined,
		},
		"node:fs": { existsSync: options.existsSync ?? (() => false) },
		"./rich-text": richText,
		"./CardStream": { CardStream: { open: async () => ({}) } },
		"./docActions": { buildFeishuTextChildren: () => [], stripFeishuActionMarkers: (text) => text, wantsFeishuDoc: () => undefined },
		"./fileIntent": { hasExplicitFeishuFileSendIntent: () => false },
		"./CardRunState": cardState,
		"./CardRenderer": { renderRunCard: () => ({}) },
		"./ModelPickerCard": { buildModelPickerCard: () => ({}), parseModelActionValue: () => undefined },
	};
	vm.runInNewContext(output, {
		module,
		exports: module.exports,
		require: (specifier) => imports[specifier] ?? (() => { throw new Error(`unexpected import: ${specifier}`); })(),
		console,
		Buffer,
		setTimeout,
		clearTimeout,
		Promise,
	}, { filename: "FeishuBridge.ts" });
	return module.exports;
}

function makeAgent(id, projectId = "p", sessionPath = `/sessions/${id}.json`) {
	return { id, projectId, sessionPath, title: id, cwd: ".", status: "idle", createdAt: 1 };
}

function makeBridge(agents, gateway, calls = {}) {
	const { FeishuBridge } = compileBridge();
	const manager = {
		list: () => agents,
		create: async () => { const tab = manager.list()[0]; calls.create = (calls.create ?? 0) + 1; return tab; },
		stop: async (id) => calls.stop?.push(id),
		abort: async (id) => calls.abort?.push(id),
		getAvailableModels: async (id) => { calls.models?.push(id); return []; },
		getRuntimeState: async (id) => { calls.states?.push(id); return undefined; },
		setModel: async (id, provider, modelId) => calls.setModel?.push([id, provider, modelId]),
		getMessages: () => [],
		addLocalEventListener: () => () => undefined,
	};
	const bridge = new FeishuBridge(
		{ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" },
		manager,
		() => null,
		() => [{ id: "p", name: "project", path: "." }],
		gateway,
	);
	bridge.status = { status: "connected", activeBindings: 0 };
	return { bridge, manager };
}

test("create stores stable catalog sessionId and separate runtime agentId", async () => {
	const tab = makeAgent("A");
	const bindCalls = [];
	const { bridge } = makeBridge([tab], { bindRuntime: async ({ agent }) => {
		bindCalls.push(agent.id);
		return { sessionId: "S", runtimeGeneration: 1 };
	} });
	await bridge.createNewSession({ chatId: "chat", senderOpenId: "user", chatType: "p2p", groupName: "", messageId: "m" });
	assert.equal(JSON.stringify(bridge.listBindings().map(({ sessionId, agentId }) => ({ sessionId, agentId }))), JSON.stringify([{ sessionId: "S", agentId: "A" }]));
	assert.deepEqual(bindCalls, ["A"]);
	assert.equal(bridge.getSessionChatId("S"), "chat");
	assert.equal(bridge.getSessionChatId("A"), "chat");
});

test("gateway-authorized draft recreation preserves the existing stable session ID", async () => {
	const oldTab = makeAgent("A", "p", "");
	const calls = { abort: [], setModel: [], models: [] };
	const bindInputs = [];
	const gateway = { bindRuntime: async (input) => {
		bindInputs.push({ agentId: input.agent.id, existingSessionId: input.existingSessionId });
		return { sessionId: "S", runtimeGeneration: 2 };
	} };
	const { bridge } = makeBridge([oldTab], gateway, calls);
	await bridge.createNewSession({ chatId: "chat", senderOpenId: "user", chatType: "p2p", groupName: "", messageId: "m" });
	const nextTab = makeAgent("B", "p", "");
	bridge.agentManager.list = () => [nextTab];
	const binding = bridge.listBindings()[0];
	const restored = await bridge.resumeOrCreateAgent(binding);
	assert.equal(restored.sessionId, "S");
	assert.equal(restored.agentId, "B");
	assert.deepEqual(bindInputs, [
		{ agentId: "A", existingSessionId: undefined },
		{ agentId: "B", existingSessionId: "S" },
	]);
	assert.equal(bridge.getSessionChatId("A"), undefined);
	assert.equal(bridge.getSessionChatId("B"), "chat");
	await bridge.doSetModel("chat", "provider/model");
	await bridge.handleStopCommand({ chatId: "chat" });
	assert.deepEqual(calls.setModel, [["B", "provider", "model"]]);
	assert.deepEqual(calls.abort, ["B"]);
});

test("existing Feishu binding is reused by ensureSessionMirror without creating or overwriting a mirror", async () => {
	const persisted = [{ chatId: "feishu-chat", botId: "bot", userId: "u", sessionId: "S", agentId: "A", sessionPath: "/sessions/A.json", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1 }];
	const { FeishuBridge } = compileBridge(persisted);
	const tab = makeAgent("A");
	let tabs = [tab];
	const bridge = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, {
		list: () => tabs,
	}, () => null, () => [], { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 1 }) });
	await bridge.loadPersistedBindings();
	let createCount = 0;
	bridge.client = { im: { chat: { create: async () => { createCount += 1; return { data: { chat_id: "mirror-chat" } }; } } } };
	bridge.status = { status: "connected", activeBindings: 1 };
	assert.equal(await bridge.ensureSessionMirror("A", "Local prompt", tab.sessionPath), "feishu-chat");
	const replacementTab = makeAgent("B");
	tabs = [replacementTab];
	assert.equal(await bridge.ensureSessionMirror("B", "Local prompt", replacementTab.sessionPath), "feishu-chat");
	assert.equal(createCount, 0);
	assert.equal(JSON.stringify(bridge.listBindings().map(({ chatId, source, sessionId, agentId }) => ({ chatId, source, sessionId, agentId }))), JSON.stringify([
		{ chatId: "feishu-chat", source: "feishu", sessionId: "S", agentId: "B" },
	]));
	assert.equal(bridge.getSessionChatId("S"), "feishu-chat");
	assert.equal(bridge.getSessionChatId("A"), undefined);
	assert.equal(bridge.getSessionChatId("B"), "feishu-chat");
});

test("removing a stale binding does not remove another binding's current indexes", async () => {
	const persisted = [
		{ chatId: "current", botId: "bot", userId: "u", sessionId: "S", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1 },
		{ chatId: "stale", botId: "bot", userId: "u", sessionId: "S", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 2 },
	];
	const { FeishuBridge } = compileBridge(persisted);
	const bridge = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, { list: () => [] }, () => null, () => [], { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 1 }) });
	await bridge.loadPersistedBindings();
	assert.equal(bridge.getSessionChatId("S"), "current");
	assert.equal(bridge.removeBinding("stale"), true);
	assert.equal(bridge.getSessionChatId("S"), "current");
	assert.equal(bridge.feishuSessions.has("S"), true);
});

test("legacy ID absent from catalog may migrate to a new stable ID during resume", async () => {
	const persisted = [{ chatId: "chat", botId: "bot", userId: "u", sessionId: "legacy", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1 }];
	const { FeishuBridge } = compileBridge(persisted);
	const tab = makeAgent("B", "p", "");
	const bindInputs = [];
	const manager = {
		list: () => [],
		create: async () => tab,
		stop: async () => undefined,
	};
	const bridge = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, manager, () => null, () => [{ id: "p", name: "project", path: "." }], { bindRuntime: async (input) => {
		bindInputs.push(input.existingSessionId);
		return { sessionId: "S2", runtimeGeneration: 1 };
	} });
	await bridge.loadPersistedBindings();
	const resumed = await bridge.resumeOrCreateAgent(bridge.listBindings()[0]);
	assert.equal(resumed.sessionId, "S2");
	assert.deepEqual(bindInputs, ["legacy"]);
});

test("legacy ID and unique path candidates cannot bypass the runtime gateway", async () => {
	const tab = makeAgent("legacy", "p", "/same");
	const calls = { create: 0, stop: [] };
	const bindInputs = [];
	const { bridge } = makeBridge([tab], { bindRuntime: async (input) => {
		bindInputs.push({ agentId: input.agent.id, existingSessionId: input.existingSessionId });
		return { sessionId: "S", runtimeGeneration: 1 };
	} }, calls);
	const binding = {
		chatId: "chat", botId: "bot", userId: "u", sessionId: "legacy",
		sessionPath: "/same", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1,
	};
	bridge.chatBindings.set("chat", binding);
	const agentId = await bridge.ensureRuntimeBinding(binding);
	assert.equal(agentId, "legacy");
	assert.equal(calls.create, 1);
	assert.deepEqual(bindInputs, [{ agentId: "legacy", existingSessionId: "legacy" }]);
	assert.equal(binding.agentId, "legacy");
});

test("gateway rejection stops a resumed runtime and leaves the binding unowned", async () => {
	const tab = makeAgent("B", "p", "");
	const calls = { create: 0, stop: [] };
	const { bridge } = makeBridge([tab], { bindRuntime: async () => {
		throw new Error("active origin mismatch");
	} }, calls);
	const binding = {
		chatId: "chat", botId: "bot", userId: "u", sessionId: "S",
		workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1,
	};
	bridge.chatBindings.set("chat", binding);
	assert.equal(await bridge.ensureRuntimeBinding(binding), undefined);
	assert.equal(calls.create, 1);
	assert.deepEqual(calls.stop, ["B"]);
	assert.equal(binding.agentId, undefined);
});

test("persisted path collision with a different source stays unowned when gateway rejects it", async () => {
	const persisted = [{
		chatId: "chat", botId: "bot", userId: "u", sessionId: "S", sessionPath: "/same",
		workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1,
	}];
	const { FeishuBridge } = compileBridge(persisted);
	const tab = { ...makeAgent("B", "p", "/same"), sessionSource: "codex" };
	let gatewayCalls = 0;
	const bridge = new FeishuBridge(
		{ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" },
		{ list: () => [tab] },
		() => null,
		() => [],
		{ bindRuntime: async () => {
			gatewayCalls += 1;
			throw new Error("source mismatch");
		} },
	);
	await bridge.loadPersistedBindings();
	assert.equal(gatewayCalls, 1);
	assert.equal(bridge.listBindings()[0].sessionId, "S");
	assert.equal(bridge.listBindings()[0].agentId, undefined);
});

test("one persisted row and one runtime path candidate migrate through the gateway", async () => {
	const legacy = [{ chatId: "chat", botId: "bot", userId: "u", sessionId: "A", sessionPath: "/same", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1 }];
	const tab = makeAgent("B", "p", "/same");
	const { bridge } = makeBridge([tab], { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 3 }) });
	const { FeishuBridge } = compileBridge(legacy);
	const manager = bridge.agentManager;
	const bindInputs = [];
	const loaded = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, manager, () => null, () => [], { bindRuntime: async (input) => {
		bindInputs.push(input.existingSessionId);
		return { sessionId: "S", runtimeGeneration: 3 };
	} });
	await loaded.loadPersistedBindings();
	assert.equal(JSON.stringify(loaded.listBindings().map(({ sessionId, agentId }) => ({ sessionId, agentId }))), JSON.stringify([{ sessionId: "S", agentId: "B" }]));
	assert.deepEqual(bindInputs, ["A"]);
});

test("two persisted rows sharing a path stay unowned even with one runtime candidate", async () => {
	const legacy = { botId: "bot", userId: "u", sessionPath: "/same", workspaceId: "", chatType: "p2p", createdAt: 1 };
	const ambiguous = [
		{ ...legacy, chatId: "one", sessionId: "old-one", source: "feishu" },
		{ ...legacy, chatId: "two", sessionId: "old-two", source: "session-mirror" },
	];
	const { FeishuBridge } = compileBridge(ambiguous);
	const bindInputs = [];
	const bridge = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, {
		list: () => [makeAgent("B", "p", "/same")],
	}, () => null, () => [], { bindRuntime: async (input) => {
		bindInputs.push(input);
		return { sessionId: "unexpected", runtimeGeneration: 1 };
	} });
	await bridge.loadPersistedBindings();
	assert.equal(JSON.stringify(bridge.listBindings().map(({ sessionId, agentId }) => ({ sessionId, agentId }))), JSON.stringify([
		{ sessionId: "old-one" },
		{ sessionId: "old-two" },
	]));
	assert.equal(bindInputs.length, 0);
});
