import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const source = readFileSync("src/shared/sessionIdentity.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "sessionIdentity.ts",
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: "sessionIdentity.ts" });
  return sandbox.module.exports;
}

function loadAgentIdentity() {
  const identity = loadModule();
  const filePath = "src/main/pi/agentSessionIdentity.ts";
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "../../shared/sessionIdentity") return identity;
      throw new Error(`Unexpected import: ${specifier}`);
    },
  }, { filename: filePath });
  return module.exports;
}

test("canonicalizes native session paths without collapsing WSL case", () => {
  const { canonicalizeSessionPath } = loadModule();
  assert.equal(
    canonicalizeSessionPath("C:\\Users\\Dev\\.pi\\sessions\\A.jsonl/", "native"),
    "c:/users/dev/.pi/sessions/a.jsonl",
  );
  assert.equal(
    canonicalizeSessionPath("/home/dev/.pi/sessions/Case.jsonl/", "wsl"),
    "/home/dev/.pi/sessions/Case.jsonl",
  );
});

test("keeps source and WSL identity in the session origin key", () => {
  const { buildSessionOriginKey } = loadModule();
  const native = buildSessionOriginKey({
    source: "pi",
    environment: "native",
    filePath: "C:\\Users\\Dev\\session.jsonl",
  });
  const wsl = buildSessionOriginKey({
    source: "pi",
    environment: "wsl",
    filePath: "/mnt/c/Users/Dev/session.jsonl",
    wslDistro: "Ubuntu",
    wslUser: "dev",
  });
  const imported = buildSessionOriginKey({
    source: "codex",
    environment: "native",
    filePath: "C:\\Users\\Dev\\session.jsonl",
    importedSourceId: "thread-1",
  });
  assert.notEqual(native, wsl);
  assert.notEqual(native, imported);
  assert.match(wsl, /^pi:wsl:Ubuntu:dev:/);
});

test("AgentManager keys preserve WSL case and identity at the process boundary", () => {
  const { buildAgentSessionKey } = loadAgentIdentity();
  const defaults = {
    environment: "wsl",
    wslDistro: "Ubuntu",
    wslUser: "dev",
  };
  const upper = buildAgentSessionKey({
    projectId: "project-1",
    sessionPath: "/home/dev/Case.jsonl",
  }, defaults);
  const lower = buildAgentSessionKey({
    projectId: "project-1",
    sessionPath: "/home/dev/case.jsonl",
  }, defaults);
  const otherDistro = buildAgentSessionKey({
    projectId: "project-1",
    sessionPath: "/home/dev/Case.jsonl",
    wslDistro: "Debian",
  }, defaults);
  assert.notEqual(upper, lower);
  assert.notEqual(upper, otherDistro);

  const agentManagerSource = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  assert.match(agentManagerSource, /buildAgentSessionKey\(input/);
  assert.doesNotMatch(agentManagerSource, /normalizeSessionPathForCompare/);
});
