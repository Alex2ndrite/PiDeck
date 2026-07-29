import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coordinator = readFileSync(
  "src/main/sessions/SessionRuntimeCoordinator.ts",
  "utf8",
);
const main = readFileSync("src/main/index.ts", "utf8");
const sessionIpc = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const runtimeInjector = readFileSync(
  "src/renderer/src/components/session/SessionRuntimeInjector.tsx",
  "utf8",
);
const runtimeUi = readFileSync(
  "src/renderer/src/components/overlays/SessionRuntimeUiOverlay.tsx",
  "utf8",
);
const composer = readFileSync(
  "src/renderer/src/components/session/ComposerArea.tsx",
  "utf8",
);

test("catalog scans attach matching existing runtimes in the main process", () => {
  assert.match(coordinator, /attachCatalogRuntimes\(/);
  assert.match(main, /attachCatalogRuntimes\(records\)/);
  assert.match(sessionIpc, /sessionsCatalogList[\s\S]*mergeScanned[\s\S]*attachCatalogRuntimes/);
});

test("unbound interactive UI is cancelled and cannot be surfaced as Session UI", () => {
  assert.match(main, /cancelUnboundUiRequest/);
  assert.match(main, /sendUIResponse\([^,]+,[^,]+, \{ cancelled: true \}\)/);
  assert.doesNotMatch(app, /bindSessionRuntimeAtom|bindSessionRuntime\(/);
  assert.doesNotMatch(app, /api\.agents\.onUiRequest\(/);
});

test("session UI requests remain generation-bound but render above the composer", () => {
  assert.match(runtimeInjector, /createSessionRuntimeUiResponder\(/);
  assert.match(runtimeInjector, /sessionId: currentSessionId/);
  assert.match(runtimeInjector, /runtimeGeneration: latest\.runtimeGeneration/);
  assert.match(runtimeInjector, /<SessionRuntimeUiOverlay/);
  assert.match(runtimeUi, /className="ask-inline-bar"/);
  assert.doesNotMatch(runtimeUi, /className="modal-backdrop ask-dialog-backdrop"/);
  assert.match(composer, /\{props\.runtimeUi\}/);
});

test("Web wiring is Session-first and exposes no Agent compatibility creation", () => {
  assert.match(
    main,
    /createSessionDraft: async \(input\)[\s\S]*sessionCatalog\.createDraft/,
  );
  assert.match(
    main,
    /sendSessionPrompt: async \(input\)[\s\S]*sessionRuntimeCoordinator\.send\(input\)/,
  );
  // stopSessionRuntime is now a shared helper called from both IPC and the web deps.
  assert.match(main, /async function stopSessionRuntime\(target[^)]*\)[\s\S]*sessionRuntimeCoordinator\.stopRuntime\(target\)/);
  assert.doesNotMatch(main, /createAgent:/);
  assert.doesNotMatch(main, /LEGACY_EXTERNAL_RUNTIME|ipcChannels\.agentsCreate/);
});

test("catalog deletion rejects bound or activating Session runtimes", () => {
  assert.match(sessionIpc, /sessionsCatalogDelete[\s\S]*sessionRuntimeCoordinator\.getTarget\(sessionId\)[\s\S]*sessionRuntimeCoordinator\.isActivating\(sessionId\)/);
  assert.match(main, /deleteSessionRecord: async \(sessionId\)[\s\S]*sessionRuntimeCoordinator\.getTarget\(sessionId\)[\s\S]*sessionRuntimeCoordinator\.isActivating\(sessionId\)/);
  assert.match(coordinator, /isActivating\(sessionId: string\): boolean/);
});

test("replacement restore is gated by full origin identity in main", () => {
  assert.match(main, /const originKey = originEntry\?\.filePath[\s\S]*buildSessionOriginKey/);
  assert.match(main, /canRestoreOrigin: \(\) => \{[\s\S]*buildSessionOriginKey[\s\S]*\) === originKey;/);
  assert.match(coordinator, /failClosedRuntimeReplacement/);
  assert.match(coordinator, /replacementBySession/);
});
