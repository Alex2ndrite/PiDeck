import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coordinator = readFileSync(
  "src/main/sessions/SessionRuntimeCoordinator.ts",
  "utf8",
);
const main = readFileSync("src/main/index.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");

test("catalog scans attach matching existing runtimes in the main process", () => {
  assert.match(coordinator, /attachCatalogRuntimes\(/);
  assert.match(main, /attachCatalogRuntimes\(records\)/);
  assert.match(main, /sessionsCatalogList[\s\S]*mergeScanned[\s\S]*attachCatalogRuntimes/);
});

test("unbound interactive UI is cancelled and cannot be surfaced as Session UI", () => {
  assert.match(main, /cancelUnboundUiRequest/);
  assert.match(main, /sendUIResponse\([^,]+,[^,]+, \{ cancelled: true \}\)/);
  assert.doesNotMatch(app, /bindSessionRuntimeAtom|bindSessionRuntime\(/);
  assert.doesNotMatch(app, /api\.agents\.onUiRequest\(/);
});

test("legacy and external create entry points are explicitly classified", () => {
  assert.match(main, /LEGACY_EXTERNAL_RUNTIME/);
  assert.match(main, /agentsCreate[\s\S]*LEGACY_EXTERNAL_RUNTIME/);
  assert.match(main, /createAgent: \(input\)[\s\S]*LEGACY_EXTERNAL_RUNTIME/);
});

test("replacement restore is gated by full origin identity in main", () => {
  assert.match(main, /const originKey = originEntry\?\.filePath[\s\S]*buildSessionOriginKey/);
  assert.match(main, /canRestoreOrigin: \(\) => \{[\s\S]*buildSessionOriginKey[\s\S]*\) === originKey;/);
  assert.match(coordinator, /failClosedRuntimeReplacement/);
  assert.match(coordinator, /replacementBySession/);
});
