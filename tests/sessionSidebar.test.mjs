import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadControllerModule() {
  const output = ts.transpileModule(
    readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: "useSidebarController.ts",
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    JSON,
    Object,
    Set,
    Map,
    require: (specifier) => {
      if (specifier === "react") return {};
      if (specifier === "jotai") return {};
      if (specifier === "../atoms") return {};
      throw new Error(`Unexpected import: ${specifier}`);
    },
  }, { filename: "useSidebarController.ts" });
  return module.exports;
}

test("source filters preserve all sources until the user narrows a project", () => {
  const { filterSidebarSessions, serializeSidebarSourceFilters, readSidebarSourceFilters } = loadControllerModule();
  const sessions = [{ source: "pi" }, { source: "codex" }, { source: "claude" }];
  assert.equal(filterSidebarSessions(sessions, null).length, 3);
  assert.deepEqual(
    filterSidebarSessions(sessions, new Set(["codex"])),
    [{ source: "codex" }],
  );
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  storage.setItem("pideck-session-source-filter", serializeSidebarSourceFilters({ project: new Set(["pi", "codex"]) }));
  assert.deepEqual([...readSidebarSourceFilters(storage).project], ["pi", "codex"]);
});

test("Sidebar controller derives catalog data from canonical atoms without a writable SessionSummary cache", () => {
  const source = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  assert.match(source, /useAtomValue\(sessionRecordsAtom\)/);
  assert.match(source, /useAtomValue\(sessionIdsByProjectAtom\)/);
  assert.match(source, /useAtomValue\(sessionRuntimeByIdAtom\)/);
  assert.doesNotMatch(source, /useState<[^>]*SessionSummary\[\]/);
});

test("Session tree keys use catalog SessionRecord identity, including child rows", () => {
  const source = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  assert.match(source, /key=\{getSessionRowKey\(session\)\}/);
  assert.match(source, /key=\{getSessionRowKey\(child\.session\)\}/);
  assert.doesNotMatch(source, /key=\{session\.filePath\}/);
  assert.doesNotMatch(source, /key=\{child\.session\.filePath\}/);
});

test("Sidebar leaf remains independent from App and keeps RPC logging query local", () => {
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  const content = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
  assert.doesNotMatch(controller, /App\.tsx/);
  assert.doesNotMatch(content, /from "\.\.\/\.\.\/App"/);
  assert.match(controller, /getRpcLogging/);
  assert.match(controller, /setAgentRpcLoggingById/);
  assert.match(content, /RpcLogModal/);
  assert.match(content, /SessionManagerModal/);
  assert.match(content, /WorktreeCreateDialog/);
});
