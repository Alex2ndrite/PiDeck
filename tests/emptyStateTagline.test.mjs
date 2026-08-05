import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parts = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const i18n = [
  readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8"),
  readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8"),
].join("\n");

test("empty state is a project-aware workspace entry point", () => {
  assert.match(parts, /data-empty-state=\{props\.hasProject \? "project" : "no-project"\}/);
  assert.match(parts, /t\("app\.emptyProjectTitle"\)/);
  assert.match(parts, /t\("app\.emptyNoProjectTitle"\)/);
  // #113 中性化改版：空态不再绘制品牌渐变 Logo 与光晕，保持纯白基底 + 标题层级。
  assert.doesNotMatch(parts, /logo-mark-gradient/);
  assert.match(parts, /font-brand text-\[clamp\(2rem,4vw,3rem\)\]/);
  assert.match(parts, /text-balance/);
  assert.match(parts, /font-brand text-\[clamp\(1rem,1\.8vw,1\.15rem\)\]/);
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
