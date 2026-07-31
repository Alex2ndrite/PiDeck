import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { SessionHistoryReader } = loadTsCommonJs(
  "src/main/pi/SessionHistoryReader.ts",
);

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

function createReader(toHostPath) {
  return new SessionHistoryReader({
    toHostPath,
    convertMessages: (_agentId, rawMessages, entryIds = []) => rawMessages.map((message, index) => ({
      id: entryIds[index] ?? `message-${index}`,
      role: message.role,
      text: textFromContent(message.content),
    })),
    trimMessages: (messages) => messages,
    translate: () => "Summary unavailable.",
  });
}

test("SessionHistoryReader resolves the host path before loading a persisted Session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pideck-history-reader-"));
  const hostPath = join(directory, "session.jsonl");
  const requestedPaths = [];
  try {
    await writeFile(hostPath, [
      JSON.stringify({ id: "session", type: "session" }),
      JSON.stringify({
        id: "message-1",
        parentId: "session",
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "mapped host path" }] },
      }),
    ].join("\n"), "utf8");
    const reader = createReader((sessionPath) => {
      requestedPaths.push(sessionPath);
      return hostPath;
    });

    const messages = await reader.readSessionDisplayMessages("/root/.pi/session.jsonl");
    assert.deepEqual(requestedPaths, ["/root/.pi/session.jsonl"]);
    assert.equal(messages[0].text, "mapped host path");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SessionHistoryReader pages only the active branch and tolerates malformed JSONL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pideck-history-branch-"));
  const sessionPath = join(directory, "session.jsonl");
  try {
    await writeFile(sessionPath, [
      JSON.stringify({ id: "session", type: "session" }),
      JSON.stringify({
        id: "active-1",
        parentId: "session",
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "active one" }] },
      }),
      "{ not valid json",
      JSON.stringify({
        id: "detached",
        parentId: "session",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "detached" }] },
      }),
      JSON.stringify({
        id: "active-2",
        parentId: "active-1",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "active two" }] },
      }),
    ].join("\n"), "utf8");
    const reader = createReader((path) => path);

    const page = await reader.readSessionDisplayMessagePage(sessionPath, "viewer", undefined, 100);
    assert.equal(page.total, 2);
    assert.deepEqual(Array.from(page.messages, (message) => message.text), ["active one", "active two"]);
    assert.equal(page.nextBefore, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
