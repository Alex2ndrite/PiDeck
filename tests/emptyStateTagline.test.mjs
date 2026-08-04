import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parts = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const i18n = [
  readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8"),
  readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8"),
].join("\n");

test("empty state is a branded, project-aware workspace entry point", () => {
  assert.match(parts, /data-empty-state=\{props\.hasProject \? "project" : "no-project"\}/);
  assert.match(parts, /t\("app\.emptyProjectTitle"\)/);
  assert.match(parts, /t\("app\.emptyNoProjectTitle"\)/);
  assert.match(parts, /bg-\[image:var\(--logo-mark-gradient\)\] text-primary-foreground/);
  assert.match(parts, /font-brand text-\[clamp\(2\.25rem,5vw,3\.25rem\)\]/);
  assert.match(parts, /text-balance/);
  assert.match(parts, /font-brand text-\[clamp\(1\.05rem,2vw,1\.25rem\)\]/);
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
