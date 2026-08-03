import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parts = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const i18n = [
  readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8"),
  readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8"),
].join("\n");

test("empty state is a compact, project-aware workspace entry point", () => {
  assert.match(parts, /data-empty-state=\{props\.hasProject \? "project" : "no-project"\}/);
  assert.match(parts, /t\("app\.emptyProjectTitle"\)/);
  assert.match(parts, /t\("app\.emptyNoProjectTitle"\)/);
  assert.match(parts, /bg-primary text-primary-foreground/);
  assert.match(parts, /className="mt-4 text-lg font-semibold text-foreground"/);
  assert.match(parts, /className="mt-1\.5 max-w-md text-sm leading-6 text-muted-foreground"/);
  assert.doesNotMatch(parts, /empty-tagline|empty-logo|empty-subtitle|empty-state-cta/);
  assert.doesNotMatch(parts, /There are many agent harnesses|Pi is a minimal agent harness/);

  for (const key of [
    "app.emptyProjectTitle",
    "app.emptyNoProjectTitle",
    "app.emptyHasProject",
    "app.emptyNoProject",
  ]) {
    assert.ok(i18n.includes(`"${key}"`), `${key} must exist in both locales`);
  }
  assert.doesNotMatch(i18n, /app\.emptyTagline|app\.emptySubtitle/);
});
