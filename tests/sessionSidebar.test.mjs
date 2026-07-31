import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadTsModule(path, fileName, requireStub) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    JSON,
    Object,
    Set,
    Map,
    require: requireStub,
  }, { filename: fileName });
  return module.exports;
}

function loadExpandedProjectsModule() {
  return loadTsModule(
    "src/renderer/src/utils/sidebarExpandedProjects.ts",
    "sidebarExpandedProjects.ts",
    (specifier) => {
      throw new Error(`Unexpected import: ${specifier}`);
    },
  );
}

function loadControllerModule() {
  return loadTsModule(
    "src/renderer/src/hooks/useSidebarController.ts",
    "useSidebarController.ts",
    (specifier) => {
      if (specifier === "react") return {};
      if (specifier === "jotai") return {};
      if (specifier === "../atoms") return {};
      if (specifier === "../utils/sidebarExpandedProjects") return loadExpandedProjectsModule();
      throw new Error(`Unexpected import: ${specifier}`);
    },
  );
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
  assert.match(source, /useAtomValue\(sidebarRuntimeAtom\)/);
  assert.doesNotMatch(source, /useState<[^>]*SessionSummary\[\]/);
});

test("Session tree keys use catalog SessionRecord identity, including child rows", () => {
  const source = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  assert.match(source, /key=\{session\.id\}/);
  assert.match(source, /key=\{child\.session\.id\}/);
  assert.doesNotMatch(source, /key=\{session\.filePath\}/);
  assert.doesNotMatch(source, /key=\{child\.session\.filePath\}/);
});

test("runtime context authorization uses the record binding instead of a same-path agent", () => {
  const { getBoundSidebarRuntimeAgent } = loadControllerModule();
  const catalog = {
    runtimeBySessionId: {
      "session-a": { agentId: "stale", status: "running" },
      "session-b": { agentId: "detached", status: "detached" },
      "session-c": { agentId: "live", status: "running" },
    },
    agents: [
      { id: "stale", status: "closed", sessionPath: "C:/same.jsonl" },
      { id: "same-path-but-unbound", status: "running", sessionPath: "C:/same.jsonl" },
      { id: "detached", status: "running", sessionPath: "C:/other.jsonl" },
      { id: "live", status: "running", sessionPath: "C:/live.jsonl" },
    ],
  };
  assert.equal(getBoundSidebarRuntimeAgent(catalog, "session-a"), undefined);
  assert.equal(getBoundSidebarRuntimeAgent(catalog, "session-b"), undefined);
  assert.equal(getBoundSidebarRuntimeAgent(catalog, "session-c").id, "live");
  const source = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  assert.match(source, /getBoundSidebarRuntimeAgent\(props\.controller\.catalog, session\.id\)/);
  assert.doesNotMatch(source, /getAgentForSessionPath/);
});

test("request gate rejects stale menu and RPC results after a newer request or close", () => {
  const { createSidebarRequestGate } = loadControllerModule();
  const gate = createSidebarRequestGate();
  const menuA = gate.beginMenu();
  const menuB = gate.beginMenu();
  assert.equal(gate.isCurrentMenu(menuA), false);
  assert.equal(gate.isCurrentMenu(menuB), true);
  gate.cancelMenu();
  assert.equal(gate.isCurrentMenu(menuB), false);
  const rpcA = gate.beginRpcLogs();
  const rpcB = gate.beginRpcLogs();
  assert.equal(gate.isCurrentRpcLogs(rpcA), false);
  assert.equal(gate.isCurrentRpcLogs(rpcB), true);
  gate.cancelRpcLogs();
  assert.equal(gate.isCurrentRpcLogs(rpcB), false);
});

test("unstarted drafts have an independent delete control and context menu", () => {
  const sessionTree = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  const content = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  const parts = readFileSync("src/renderer/src/components/sidebar/SidebarParts.tsx", "utf8");
  const components = readFileSync("src/renderer/src/components/sidebar/SidebarComponents.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/workspace.css", "utf8");

  assert.match(controller, /kind: "draft"/);
  assert.match(sessionTree, /const openDraftContext/);
  assert.match(sessionTree, /getBoundSidebarRuntimeAgent\(props\.controller\.catalog, session\.id\)/);
  assert.match(sessionTree, /kind: "agent",\s*agentId: runtimeAgent\.id/);
  assert.match(sessionTree, /draft-session-row/);
  assert.match(sessionTree, /has-runtime/);
  assert.match(sessionTree, /onContextMenu=\{\(event\) => openDraftContext\(event, session\)\}/);
  assert.match(sessionTree, /canDelete && \([\s\S]*<IconButton[\s\S]*className="draft-session-delete"/);
  assert.doesNotMatch(sessionTree, /<span className="project-action" role="button"/);
  assert.match(parts, /DraftSessionContextMenu/);
  assert.match(components, /export function DraftSessionContextMenu/);
  assert.match(content, /menu\?\.kind === "draft"/);
  assert.match(content, /!hasLiveSidebarRuntime\(menuDraftRuntime\)/);
  assert.match(content, /<DraftSessionContextMenu/);
  // draft 行布局改由 SessionTree Tailwind 承担（pure official P2-2）
  assert.match(sessionTree, /grid-cols-\[minmax\(0,1fr\)_2rem\]/);
  assert.match(sessionTree, /has-runtime/);
  assert.match(styles, /\.draft-session-delete/);
});

test("worktree rows expose their child project context menu and loading projects keep a surface", () => {
  const worktree = readFileSync("src/renderer/src/components/sidebar/WorktreeTree.tsx", "utf8");
  const sessionTree = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  assert.match(worktree, /kind: "project",\s*projectId: childProject\.id/);
  assert.match(worktree, /className="conversation worktree-workspace-header"/);
  assert.match(worktree, /className="conversation worktree-row"/);
  assert.doesNotMatch(worktree, /currentProjectId|toggleProjectExpanded/);
  assert.match(controller, /useAtomValue\(sessionCatalogLoadStateAtom\)/);
  assert.match(sessionTree, /catalogLoadStateByProject\[props\.project\.id\]\?\.status === "loading"/);
  assert.match(sessionTree, /catalogLoading \|\| draftSessions\.length/);
  assert.match(sessionTree, /project-session-loading/);
});

test("sidebar expansion migration waits for authoritative settings before pruning projects", () => {
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  assert.match(controller, /if \(projects\.length === 0 \|\| !options\.settingsLoaded\) return;/);
  assert.match(controller, /commitExpandedProjectIds\(pruned\)/);
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

test("AppSidebar owns the controller while App keeps business actions as ports", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const root = readFileSync("src/renderer/src/components/sidebar/AppSidebar.tsx", "utf8");
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  const projectTree = readFileSync("src/renderer/src/components/sidebar/ProjectTree.tsx", "utf8");
  assert.doesNotMatch(app, /useSidebarController/);
  assert.match(root, /const controller = useSidebarController\(/);
  assert.match(root, /getRpcLogging: props\.actions\.rpc\.getLogging/);
  assert.match(root, /controller=\{controller\}/);
  assert.match(app, /const sidebarActions: SidebarActions/);
  assert.match(app, /useAtomValue\(sidebarExpandedProjectIdsAtom\)/);
  assert.match(controller, /useAtom\(sidebarExpandedProjectIdsAtom\)/);
  assert.match(projectTree, /if \(props\.controller\.search\.trim\(\)\) return;/);
});

test("sidebar uses the dev-style source filter overlay and anonymous Session entry", () => {
  const projectTree = readFileSync("src/renderer/src/components/sidebar/ProjectTree.tsx", "utf8");
  const sessionTree = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
  const content = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
  const controller = readFileSync("src/renderer/src/hooks/useSidebarController.ts", "utf8");
  const header = readFileSync("src/renderer/src/components/session/SessionHeader.tsx", "utf8");
  assert.doesNotMatch(projectTree, /sourceFilterOpenProjectId|session-source-filter-menu/);
  assert.match(projectTree, /sourceFilter !== null/);
  assert.match(projectTree, /createAnonymous\(project\.id\)/);
  assert.match(content, /SessionSourceFilterMenu/);
  assert.match(controller, /toggleSourceFilter/);
  assert.match(sessionTree, /anonymous-indicator/);
  assert.match(sessionTree, /runtimeBySessionId\[session\.id\]\?\.agentId === child\.agent\.id/);
  assert.match(header, /anonymous-badge/);
});

test("ProjectTree shows the project directory name like the dev reference", () => {
  const projectTree = readFileSync("src/renderer/src/components/sidebar/ProjectTree.tsx", "utf8");
  assert.match(projectTree, /function displayProjectDirectoryName\(project: Project\)/);
  assert.match(projectTree, /project\.path\.replace\(/);
  assert.match(projectTree, /const projectDirectoryName = chat/);
  assert.match(projectTree, /title=\{project\.path\}/);
  assert.match(projectTree, /\{projectDirectoryName\}/);
});
