import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);

function loadAgentManagerModule() {
  const output = ts.transpileModule(
    readFileSync("src/main/pi/AgentManager.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: "AgentManager.ts",
    },
  ).outputText;
  const module = { exports: {} };
  class LatestByKeyEmitter {
    constructor() {}
    cancel() {}
  }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "electron") {
        return { app: { getName: () => "PiDeck" }, Notification: { isSupported: () => false } };
      }
      if (specifier === "../../shared/ipc") return { ipcChannels: {} };
      if (specifier === "./PiProcess") return { PiProcess: class {} };
      if (specifier === "./bashResult") return { formatBashToolMessage: () => "" };
      if (specifier === "./messageContent") {
        return {
          extractMessageText: (content) => Array.isArray(content)
            ? content
              .filter((item) => item?.type === "text")
              .map((item) => item.text ?? "")
              .join("\n")
            : "",
        };
      }
      if (specifier === "./historyMessages") return { mergeHistoryWithPreservedMessages: (messages) => messages };
      if (specifier === "./sessionEntryIds") {
        return {
          assertResendRootEntry: () => undefined,
          findLastUserMessageLine: () => undefined,
          takeActiveEntryId: (ids, index) => ({ entryId: ids?.[index], nextIndex: index + 1 }),
        };
      }
      if (specifier === "./LatestByKeyEmitter") return { LatestByKeyEmitter };
      if (specifier === "../../shared/toolRuntimeState") return { updateActiveToolCalls: () => undefined };
      if (specifier === "../wsl/WslPaths") {
        return { toWindowsHostPath: (path) => path, toWslLinuxPath: (path) => path };
      }
      return nodeRequire(specifier);
    },
    Date,
    Map,
    Set,
    Promise,
    JSON,
    Error,
    setTimeout,
    clearTimeout,
    console,
  }, { filename: "AgentManager.ts" });
  return module.exports;
}

test("history conversion preserves an assistant turn that contains only thinking", () => {
  const { AgentManager } = loadAgentManagerModule();
  const manager = new AgentManager(
    () => undefined,
    () => null,
    { get: () => ({}) },
    {},
  );

  const messages = manager.convertAgentMessages("agent-1", [{
    role: "assistant",
    content: [{ type: "thinking", thinking: "reason through the tool result" }],
    timestamp: 1,
  }], ["entry-1"]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].text, "");
  assert.equal(messages[0].thinking, "reason through the tool result");
  assert.equal(messages[0].meta.entryId, "entry-1");
});
