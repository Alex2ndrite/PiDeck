import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const displayPath = "src/renderer/src/utils/openAiCodexQuotaDisplay.ts";

function loadDisplayHelpers() {
  const source = readFileSync(displayPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const sandbox = { exports: {}, Intl, Date, Number };
  vm.runInNewContext(outputText, sandbox, { filename: displayPath });
  return sandbox.exports;
}

test("converts upstream used percentage into remaining quota", () => {
  const { remainingQuotaPercent } = loadDisplayHelpers();
  assert.equal(remainingQuotaPercent(22), 78);
  assert.equal(remainingQuotaPercent(0), 100);
  assert.equal(remainingQuotaPercent(100), 0);
  assert.equal(remainingQuotaPercent(-10), 100);
  assert.equal(remainingQuotaPercent(110), 0);
});

test("formats reset timestamp as a precise localized time to the minute", () => {
  const { formatQuotaResetAt } = loadDisplayHelpers();
  const resetAt = Date.UTC(2026, 7, 24, 0, 9);
  const formatted = formatQuotaResetAt(resetAt, "zh-CN", "Asia/Taipei");
  assert.match(formatted, /2026.*8.*24.*08:09/);
  assert.equal(formatQuotaResetAt(null, "zh-CN"), null);
});
