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

test("main injects the catalog-backed gateway into every Feishu bridge", () => {
	assert.match(mainSource, /const feishuSessionRuntimeBindings/);
	const constructors = [...mainSource.matchAll(/new FeishuBridge\(/g)].length;
	const injections = [...mainSource.matchAll(/feishuSessionRuntimeBindings/g)].length - 1;
	assert.ok(constructors >= 4);
	assert.ok(injections >= constructors);
});

function compileBridge(loadBindings = []) {
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
			getPersistentChatId: () => undefined, setPersistentChatId: () => undefined,
		},
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

test("restore updates runtime handle while keeping gateway stable session ID", async () => {
	const oldTab = makeAgent("A", "p", "");
	const calls = { abort: [], setModel: [], models: [] };
	const gateway = { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 2 }) };
	const { bridge } = makeBridge([oldTab], gateway, calls);
	await bridge.createNewSession({ chatId: "chat", senderOpenId: "user", chatType: "p2p", groupName: "", messageId: "m" });
	const nextTab = makeAgent("B", "p", "");
	bridge.agentManager.list = () => [nextTab];
	const binding = bridge.listBindings()[0];
	const restored = await bridge.resumeOrCreateAgent(binding);
	assert.equal(restored.sessionId, "S");
	assert.equal(restored.agentId, "B");
	assert.equal(bridge.getSessionChatId("A"), undefined);
	assert.equal(bridge.getSessionChatId("B"), "chat");
	await bridge.doSetModel("chat", "provider/model");
	await bridge.handleStopCommand({ chatId: "chat" });
	assert.deepEqual(calls.setModel, [["B", "provider", "model"]]);
	assert.deepEqual(calls.abort, ["B"]);
});

test("legacy persisted binding migrates through gateway and does not cross-match ambiguous paths", async () => {
	const legacy = [{ chatId: "chat", botId: "bot", userId: "u", sessionId: "A", sessionPath: "/same", workspaceId: "", source: "feishu", chatType: "p2p", createdAt: 1 }];
	const tab = makeAgent("B", "p", "/same");
	const { bridge } = makeBridge([tab], { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 3 }) });
	const { FeishuBridge } = compileBridge(legacy);
	const manager = bridge.agentManager;
	const loaded = new FeishuBridge({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, manager, () => null, () => [], { bindRuntime: async () => ({ sessionId: "S", runtimeGeneration: 3 }) });
	await loaded.loadPersistedBindings();
	assert.equal(JSON.stringify(loaded.listBindings().map(({ sessionId, agentId }) => ({ sessionId, agentId }))), JSON.stringify([{ sessionId: "S", agentId: "B" }]));

	const ambiguous = [
		{ ...legacy[0], chatId: "one", sessionId: "old-one" },
		{ ...legacy[0], chatId: "two", sessionId: "old-two", source: "session-mirror" },
	];
	const { FeishuBridge: BridgeWithAmbiguousData } = compileBridge(ambiguous);
	const ambiguousBridge = new BridgeWithAmbiguousData({ id: "bot", name: "bot", enabled: true, appId: "app", appSecret: "secret" }, {
		...manager,
		list: () => [makeAgent("B1", "p", "/same"), makeAgent("B2", "p", "/same")],
	}, () => null, () => [], { bindRuntime: async ({ agent }) => ({ sessionId: `stable-${agent.id}`, runtimeGeneration: 1 }) });
	await ambiguousBridge.loadPersistedBindings();
	assert.equal(JSON.stringify(ambiguousBridge.listBindings().map(({ agentId }) => agentId)), JSON.stringify([undefined, undefined]));
});
