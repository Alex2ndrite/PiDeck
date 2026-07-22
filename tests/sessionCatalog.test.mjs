import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rename as renameFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  }, { filename: filePath });
  return module.exports;
}

function loadCatalog(fsPromises = nodeRequire("node:fs/promises")) {
  const identity = compileModule("src/shared/sessionIdentity.ts");
  return compileModule("src/main/sessions/SessionCatalog.ts", {
    "../../shared/sessionIdentity": identity,
    "node:fs/promises": fsPromises,
  });
}

function summary(overrides = {}) {
  return {
    id: "C:/sessions/example.jsonl",
    filePath: "C:/sessions/example.jsonl",
    name: "Example",
    preview: "hello",
    updatedAt: 100,
    messageCount: 1,
    source: "pi",
    ...overrides,
  };
}

test("keeps a draft desktop session ID after Pi assigns a file path", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  try {
    const catalog = new SessionCatalog(join(dir, "sessions.json"));
    await catalog.load();
    const draft = await catalog.createDraft({
      projectId: "project-1",
      title: "New session",
      environment: "native",
      model: { provider: "openai", modelId: "gpt-test" },
      thinkingLevel: "high",
    });
    await catalog.attachRuntime({
      sessionId: draft.id,
      filePath: "C:\\Sessions\\Example.jsonl",
      piSessionId: "pi-123",
    });
    const records = await catalog.mergeScanned("project-1", [summary({
      filePath: "c:/sessions/example.jsonl",
      id: "c:/sessions/example.jsonl",
    })]);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, draft.id);
    assert.equal(records[0].status, "active");
    assert.equal(records[0].model?.provider, "openai");
    assert.equal(records[0].model?.modelId, "gpt-test");
    assert.equal(records[0].thinkingLevel, "high");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uses the configured WSL identity when a draft becomes active", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  try {
    const catalog = new SessionCatalog(join(dir, "sessions.json"), {
      wslDistro: "Ubuntu",
      wslUser: "dev",
    });
    await catalog.load();
    const draft = await catalog.createDraft({
      projectId: "project-1",
      title: "WSL draft",
      environment: "wsl",
    });
    await catalog.attachRuntime({
      sessionId: draft.id,
      filePath: "/home/dev/.pi/agent/sessions/example.jsonl",
    });
    const records = await catalog.mergeScanned("project-1", [summary({
      filePath: "/home/dev/.pi/agent/sessions/example.jsonl",
      id: "/home/dev/.pi/agent/sessions/example.jsonl",
      wsl: true,
    })], { wslDistro: "Ubuntu", wslUser: "dev" });
    assert.equal(records.length, 1);
    assert.equal(records[0].id, draft.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps imported identity after activation and rescan", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  const filePath = join(dir, "sessions.json");
  try {
    const imported = summary({
      source: "codex",
      codexSessionId: "codex-thread-42",
      filePath: "C:/sessions/codex.jsonl",
      id: "C:/sessions/codex.jsonl",
    });
    const catalog = new SessionCatalog(filePath);
    await catalog.load();
    const [first] = await catalog.mergeScanned("project-1", [imported]);
    await catalog.attachRuntime({
      sessionId: first.id,
      filePath: imported.filePath,
      piSessionId: "pi-imported",
    });

    const reloaded = new SessionCatalog(filePath);
    await reloaded.load();
    const rescanned = await reloaded.mergeScanned("project-1", [imported]);
    assert.equal(rescanned.length, 1);
    assert.equal(rescanned[0].id, first.id);
    assert.equal(rescanned[0].importedSourceId, "codex-thread-42");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("folds a scanner-created duplicate into the original draft ID", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  try {
    const catalog = new SessionCatalog(join(dir, "sessions.json"));
    await catalog.load();
    const draft = await catalog.createDraft({
      projectId: "project-1",
      title: "New session",
      environment: "native",
    });
    const scanned = summary({
      filePath: "C:/sessions/raced.jsonl",
      id: "C:/sessions/raced.jsonl",
    });
    const duringRace = await catalog.mergeScanned("project-1", [scanned]);
    assert.equal(duringRace.length, 2);

    await catalog.attachRuntime({
      sessionId: draft.id,
      filePath: "C:/sessions/raced.jsonl",
      piSessionId: "pi-raced",
    });
    const afterAttach = await catalog.mergeScanned("project-1", [scanned]);
    assert.equal(afterAttach.length, 1);
    assert.equal(afterAttach[0].id, draft.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recovers a damaged primary catalog from its atomic backup", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  const filePath = join(dir, "sessions.json");
  try {
    const catalog = new SessionCatalog(filePath);
    await catalog.load();
    const first = await catalog.createDraft({
      projectId: "project-1",
      title: "First",
      environment: "native",
    });
    await catalog.createDraft({
      projectId: "project-1",
      title: "Second",
      environment: "native",
    });
    await writeFile(filePath, "{truncated", "utf8");

    const recovered = new SessionCatalog(filePath);
    await recovered.load();
    assert.equal(recovered.listEntries().length, 1);
    assert.equal(recovered.listEntries()[0].id, first.id);
    const repaired = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(repaired.sessions[0].id, first.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed atomic write does not poison later mutations or memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  const filePath = join(dir, "sessions.json");
  let failPrimaryRename = true;
  const realFs = nodeRequire("node:fs/promises");
  const fsWithOneFailure = {
    ...realFs,
    rename: async (source, target) => {
      if (target === filePath && failPrimaryRename) {
        failPrimaryRename = false;
        const error = new Error("simulated rename failure");
        error.code = "EIO";
        throw error;
      }
      return renameFile(source, target);
    },
  };
  const { SessionCatalog } = loadCatalog(fsWithOneFailure);
  try {
    const catalog = new SessionCatalog(filePath);
    await catalog.load();
    await assert.rejects(
      catalog.createDraft({
        projectId: "project-1",
        title: "Failed",
        environment: "native",
      }),
      /simulated rename failure/,
    );
    assert.equal(catalog.listEntries().length, 0);

    const saved = await catalog.createDraft({
      projectId: "project-1",
      title: "Saved",
      environment: "native",
    });
    assert.equal(catalog.listEntries().length, 1);
    assert.equal(catalog.listEntries()[0].id, saved.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("maps scanned child parent paths to desktop session IDs and survives reload", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  const filePath = join(dir, "sessions.json");
  try {
    const catalog = new SessionCatalog(filePath);
    await catalog.load();
    const first = await catalog.mergeScanned("project-1", [
      summary({ filePath: "C:/sessions/parent.jsonl", id: "C:/sessions/parent.jsonl", name: "Parent" }),
      summary({
        filePath: "C:/sessions/parent/child.jsonl",
        id: "C:/sessions/parent/child.jsonl",
        name: "Child",
        parentSessionPath: "c:/sessions/parent.jsonl",
      }),
    ]);
    const parent = first.find((record) => record.title === "Parent");
    const child = first.find((record) => record.title === "Child");
    assert.ok(parent);
    assert.equal(child?.parentSessionId, parent?.id);

    const reloaded = new SessionCatalog(filePath);
    await reloaded.load();
    const second = await reloaded.mergeScanned("project-1", [
      summary({ filePath: "c:/sessions/parent.jsonl", id: "c:/sessions/parent.jsonl", name: "Parent" }),
      summary({
        filePath: "c:/sessions/parent/child.jsonl",
        id: "c:/sessions/parent/child.jsonl",
        name: "Child",
        parentSessionPath: "C:/sessions/parent.jsonl",
      }),
    ]);
    assert.equal(second.find((record) => record.title === "Parent")?.id, parent?.id);
    assert.equal(second.find((record) => record.title === "Child")?.parentSessionId, parent?.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime event attachment rejects active origin changes but accepts metadata drafts", () => {
  const { canAttachRuntimeMetadata } = loadCatalog();
  const active = {
    id: "old",
    projectId: "project-1",
    title: "Old",
    source: "pi",
    environment: "native",
    filePath: "C:/sessions/old.jsonl",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  };
  assert.equal(canAttachRuntimeMetadata(active, {
    sessionPath: "C:/sessions/new.jsonl",
    sessionSource: "pi",
    sessionEnvironment: "native",
  }), false);
  assert.equal(canAttachRuntimeMetadata({ ...active, filePath: undefined, status: "draft" }, {
    sessionPath: "C:/sessions/new.jsonl",
    sessionSource: "pi",
    sessionEnvironment: "native",
  }), true);
});

test("runtime replacement resolves a full-origin target without mutating the origin record", async () => {
  const { SessionCatalog } = loadCatalog();
  const dir = await mkdtemp(join(tmpdir(), "pideck-catalog-"));
  try {
    const catalog = new SessionCatalog(join(dir, "sessions.json"));
    await catalog.load();
    const [origin] = await catalog.mergeScanned("project-1", [summary({
      source: "codex",
      codexSessionId: "import-origin",
      filePath: "/home/dev/origin.jsonl",
      id: "/home/dev/origin.jsonl",
      wsl: true,
    })], { wslDistro: "Ubuntu", wslUser: "dev" });
    const before = catalog.get(origin.id);

    const target = await catalog.ensureRuntimeTarget({
      projectId: "project-1",
      title: "Replacement",
      source: "codex",
      environment: "wsl",
      filePath: "/home/dev/replacement.jsonl",
      wslDistro: "Ubuntu",
      wslUser: "dev",
      importedSourceId: "import-target",
      piSessionId: "pi-target",
    });
    const repeated = await catalog.ensureRuntimeTarget({
      projectId: "project-1",
      title: "Replacement",
      source: "codex",
      environment: "wsl",
      filePath: "/home/dev/replacement.jsonl",
      wslDistro: "Ubuntu",
      wslUser: "dev",
      importedSourceId: "import-target",
      piSessionId: "pi-target",
    });

    assert.notEqual(target.id, origin.id);
    assert.equal(repeated.id, target.id);
    assert.equal(catalog.listEntries().filter((entry) => entry.id === target.id).length, 1);
    assert.deepEqual({ ...catalog.get(origin.id) }, { ...before });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
