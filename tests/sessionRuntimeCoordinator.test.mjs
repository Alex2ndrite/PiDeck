import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);

function compileModule(filePath, imports = {}) {
  const source = readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => imports[specifier] ?? nodeRequire(specifier);
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    setTimeout,
    clearTimeout,
  }, { filename: filePath });
  return module.exports;
}

function loadCoordinator() {
  const identity = compileModule("src/shared/sessionIdentity.ts");
  return compileModule("src/main/sessions/SessionRuntimeCoordinator.ts", {
    "../../shared/sessionIdentity": identity,
  });
}

function catalogEntry(overrides = {}) {
  return {
    id: "session-1",
    projectId: "project-1",
    title: "Session 1",
    source: "pi",
    environment: "native",
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const entry = catalogEntry(options.entry);
  const calls = {
    create: 0,
    restart: 0,
    stop: 0,
    setModel: 0,
    setThinking: 0,
    attach: 0,
    send: 0,
    uiResponse: 0,
  };
  const tabs = options.tabs ? [...options.tabs] : [];
  const catalog = {
    get: (sessionId) => sessionId === entry.id ? { ...entry } : undefined,
    attachRuntime: async (input) => {
      calls.attach += 1;
      entry.filePath = input.filePath;
      entry.status = input.filePath ? "active" : entry.status;
    },
  };
  const agents = {
    list: () => tabs,
    create: async (input) => {
      calls.create += 1;
      if (options.createDelay) {
        await new Promise((resolve) => setTimeout(resolve, options.createDelay));
      }
      const tab = options.createdTab ?? {
        id: "agent-1",
        projectId: input.projectId,
        cwd: "C:/project",
        title: input.title ?? "Session 1",
        status: "idle",
        sessionId: "pi-session-1",
        sessionPath: input.sessionPath ?? "C:/sessions/session-1.jsonl",
        sessionEnvironment: input.environment,
        sessionSource: input.source,
        wslDistro: input.wslDistro,
        wslUser: input.wslUser,
        importedSourceId: input.importedSourceId,
        createdAt: 1,
      };
      tabs.push(tab);
      return tab;
    },
    restart: async (agentId) => {
      calls.restart += 1;
      const index = tabs.findIndex((tab) => tab.id === agentId);
      const previous = index >= 0 ? tabs.splice(index, 1)[0] : undefined;
      const tab = options.restartedTab ?? {
        ...previous,
        id: "agent-restarted",
        status: "idle",
        createdAt: 2,
      };
      tabs.push(tab);
      return tab;
    },
    stop: async (agentId) => {
      calls.stop += 1;
      const index = tabs.findIndex((tab) => tab.id === agentId);
      if (index >= 0) tabs.splice(index, 1);
    },
    setModel: async () => {
      calls.setModel += 1;
      if (options.modelError) throw new Error(options.modelError);
    },
    setThinking: async () => {
      calls.setThinking += 1;
    },
    sendUIResponse: async () => {
      calls.uiResponse += 1;
    },
  };
  const sender = async () => {
    calls.send += 1;
    return options.sendResult ?? { accepted: true };
  };
  return { entry, calls, tabs, catalog, agents, sender };
}

function prompt(overrides = {}) {
  return {
    sessionId: "session-1",
    requestId: "request-1",
    message: "hello",
    ...overrides,
  };
}

test("rejects an empty prompt before activating a runtime", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness();
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const result = await coordinator.send(prompt({ message: "   " }));
  assert.equal(result.accepted, false);
  assert.equal(result.delivery, "rejected");
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.send, 0);
});

test("deduplicates concurrent retries by session ID and request ID", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({ createDelay: 20 });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const [first, second] = await Promise.all([
    coordinator.send(prompt()),
    coordinator.send(prompt()),
  ]);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(first.agentId, "agent-1");
  assert.equal(harness.calls.create, 1);
  assert.equal(harness.calls.send, 1);
  assert.equal(harness.calls.attach, 2);
});

test("serializes activation but delivers distinct requests once each", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    createDelay: 20,
    entry: {
      model: { provider: "openai", modelId: "gpt-test" },
      thinkingLevel: "high",
    },
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const [first, second] = await Promise.all([
    coordinator.send(prompt({ requestId: "request-1" })),
    coordinator.send(prompt({ requestId: "request-2" })),
  ]);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(harness.calls.create, 1);
  assert.equal(harness.calls.setModel, 1);
  assert.equal(harness.calls.setThinking, 1);
  assert.equal(harness.calls.send, 2);
});

test("reuses an already-running historical session by canonical path", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    entry: {
      status: "active",
      filePath: "C:\\Sessions\\History.jsonl",
      model: { provider: "anthropic", modelId: "claude-test" },
    },
    tabs: [{
      id: "agent-history",
      projectId: "project-1",
      cwd: "C:/project",
      title: "History",
      status: "idle",
      sessionId: "pi-history",
      sessionPath: "c:/sessions/history.jsonl",
      createdAt: 1,
    }],
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const result = await coordinator.send(prompt());
  assert.equal(result.accepted, true);
  assert.equal(result.agentId, "agent-history");
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.setModel, 1);
  assert.equal(harness.calls.send, 1);
});

test("keeps a draft unbound when Agent startup fails", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    createdTab: {
      id: "agent-error",
      projectId: "project-1",
      cwd: "C:/project",
      title: "Session 1",
      status: "error",
      createdAt: 1,
    },
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const result = await coordinator.send(prompt());
  assert.equal(result.accepted, false);
  assert.equal(result.delivery, "rejected");
  assert.match(result.error, /Failed to start session runtime/);
  assert.equal(harness.entry.status, "draft");
  assert.equal(harness.calls.attach, 0);
  assert.equal(harness.calls.send, 0);
  assert.equal(harness.calls.stop, 1);
});

test("moves the Session binding when a runtime is restarted", () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    tabs: [{ id: "agent-new", status: "idle", createdAt: 2 }],
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  coordinator.bindExistingAgent("session-1", "agent-old");
  coordinator.bindExistingAgent("session-1", "agent-new");
  assert.equal(coordinator.getSessionId("agent-old"), undefined);
  assert.equal(coordinator.getSessionId("agent-new"), "session-1");
  assert.equal(coordinator.getAgentId("session-1"), "agent-new");
});

test("restart reapplies catalog preferences before binding a new generation", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    entry: {
      status: "active",
      filePath: "C:/sessions/session-1.jsonl",
      model: { provider: "openai", modelId: "gpt-test" },
      thinkingLevel: "high",
    },
    tabs: [{
      id: "agent-old",
      projectId: "project-1",
      cwd: "C:/project",
      title: "Session 1",
      status: "idle",
      sessionPath: "C:/sessions/session-1.jsonl",
      sessionEnvironment: "native",
      sessionSource: "pi",
      createdAt: 1,
    }],
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const firstGeneration = coordinator.bindExistingAgent("session-1", "agent-old");
  const restarted = await coordinator.restartSession("session-1", "agent-old");

  assert.equal(firstGeneration, 1);
  assert.equal(restarted.id, "agent-restarted");
  assert.equal(restarted.runtimeGeneration, 2);
  assert.equal(harness.calls.restart, 1);
  assert.equal(harness.calls.setModel, 1);
  assert.equal(harness.calls.setThinking, 1);
  assert.equal(harness.calls.attach, 1);
  assert.equal(coordinator.getSessionId("agent-old"), undefined);
  assert.deepEqual(
    { ...coordinator.getRuntimeBinding("agent-restarted") },
    { sessionId: "session-1", runtimeGeneration: 2 },
  );
});

test("does not send or bind a new runtime when model setup fails", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    entry: { model: { provider: "bad", modelId: "missing" } },
    modelError: "model unavailable",
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const result = await coordinator.send(prompt());
  assert.equal(result.accepted, false);
  assert.equal(result.delivery, "rejected");
  assert.match(result.error, /model unavailable/);
  assert.equal(harness.entry.status, "draft");
  assert.equal(harness.calls.attach, 0);
  assert.equal(harness.calls.send, 0);
  assert.equal(harness.calls.stop, 1);
});

test("attaches catalog runtimes by full origin identity", () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    tabs: [{
      id: "agent-existing",
      projectId: "project-1",
      cwd: "/workspace",
      title: "Existing",
      status: "idle",
      sessionPath: "/home/dev/session.jsonl",
      sessionEnvironment: "wsl",
      sessionSource: "pi",
      wslDistro: "Ubuntu",
      wslUser: "dev",
      createdAt: 1,
    }],
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const bindings = coordinator.attachCatalogRuntimes([{
    ...catalogEntry({
      environment: "wsl",
      filePath: "/home/dev/session.jsonl",
      wslDistro: "Ubuntu",
      wslUser: "dev",
      status: "active",
    }),
    preview: "",
    messageCount: 0,
  }]);

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].agentId, "agent-existing");
  assert.deepEqual(
    { ...coordinator.getRuntimeBinding("agent-existing") },
    { sessionId: "session-1", runtimeGeneration: 1 },
  );
});

test("Session UI response requires the current binding, generation, and pending request", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = createHarness({
    tabs: [{ id: "agent-a", status: "idle", createdAt: 1 }],
  });
  const coordinator = new SessionRuntimeCoordinator(
    harness.catalog,
    harness.agents,
    harness.sender,
  );
  const generation = coordinator.bindExistingAgent("session-1", "agent-a");
  coordinator.observeRuntimeEvent({
    sessionId: "session-1",
    agentId: "agent-a",
    runtimeGeneration: generation,
    sourceChannel: "agents:ui-request",
    payload: {
      agentId: "agent-a",
      requestId: "request-ui",
      method: "confirm",
      title: "Continue?",
    },
  });

  await assert.rejects(
    coordinator.respondToUi({
      sessionId: "session-1",
      requestId: "request-ui",
      agentId: "agent-a",
      runtimeGeneration: generation - 1,
      response: { confirmed: true },
    }),
    /runtime binding changed/i,
  );
  await coordinator.respondToUi({
    sessionId: "session-1",
    requestId: "request-ui",
    agentId: "agent-a",
    runtimeGeneration: generation,
    response: { confirmed: true },
  });
  await assert.rejects(
    coordinator.respondToUi({
      sessionId: "session-1",
      requestId: "request-ui",
      agentId: "agent-a",
      runtimeGeneration: generation,
      response: { confirmed: true },
    }),
    /not pending/i,
  );
  assert.equal(harness.calls.uiResponse, 1);
});
