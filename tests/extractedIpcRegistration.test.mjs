import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("src/main/index.ts", "utf8");
const sessionIpc = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const scratchPadIpc = readFileSync("src/main/ipc/scratchPadIpc.ts", "utf8");

test("extracted session and scratch-pad IPC modules remain registered by the main entry", () => {
  assert.match(entry, /registerScratchPadIpc\(\{\s*appLogger,?\s*\}\)/);
  assert.match(
    entry,
    /registerSessionIpc\(\{[\s\S]*projectStore,[\s\S]*settingsStore,[\s\S]*sessionScanner,[\s\S]*sessionCatalog,[\s\S]*sessionRuntimeCoordinator,[\s\S]*agentManager,[\s\S]*configManager,[\s\S]*terminalManager,[\s\S]*replaceAgentSession,[\s\S]*\}\)/,
  );
  assert.doesNotMatch(sessionIpc, /from\s+["']\.\.\/index["']/);
  assert.doesNotMatch(scratchPadIpc, /from\s+["']\.\.\/index["']/);
});

test("catalog session loading remains owned by the registered session IPC module", () => {
  assert.match(sessionIpc, /ipcChannels\.sessionsCatalogList/);
  assert.match(sessionIpc, /sessionCatalog\.mergeScanned/);
});
