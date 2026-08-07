import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 阶段1：独立流式正文通道（agents:text-stream）。
 *
 * 学 Proma：流式正文存在独立 atom（streamingTextByIdAtom），不再依赖
 * messages 数组里最后一条 assistant 消息增长（那会触发全量分组重渲染）。
 * 主进程 textEmitter（16ms）+ agents:text-stream 通道 → 渲染层 atom。
 */

test("main process: textEmitter tracks and pushes streaming text", () => {
  const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");

  // textEmitter 存在，窗口 16ms（比 messages 50ms 快，保证逐字感）
  assert.match(agentManager, /private readonly textEmitter = new LatestByKeyEmitter/);
  assert.match(agentManager, /private static readonly MESSAGE_FLUSH_INTERVAL_MS = 50/);

  // text_delta 时：累积文本 + textEmitter.push
  assert.match(agentManager, /this\.streamingText\.set\(agentId, nextText\)/);
  assert.match(agentManager, /this\.textEmitter\.push\(agentId, stripAnsi\(nextText\)\)/);

  // message_end / agent_end / agent_settled / abort 清除
  const cancelCount = agentManager.match(/this\.textEmitter\.cancel\(agentId\)/g)?.length ?? 0;
  assert.ok(cancelCount >= 4, "textEmitter must cancel on end/settled/abort paths");
  const deleteCount = agentManager.match(/this\.streamingText\.delete\(agentId\)/g)?.length ?? 0;
  assert.ok(deleteCount >= 4, "streamingText must clear on end/settled/abort paths");
});

test("main process: message_end pushes final text with done flag", () => {
  const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  assert.match(
    agentManager,
    /this\.emitTextStreamNow\(agentId, finalText, true\)/,
  );
  assert.match(agentManager, /emitTextStreamNow\(agentId: string, text: string, done = false\)/);
});

test("renderer: streamingTextByIdAtom updates from agents:text-stream and clears on done", () => {
  const atoms = readFileSync("src/renderer/src/atoms/session-atoms.ts", "utf8");
  assert.match(atoms, /export const streamingTextByIdAtom = atom/);
  assert.match(atoms, /Record<string, \{ content: string; streaming: boolean \}>/);
  assert.match(atoms, /event\.sourceChannel === "agents:text-stream"/);
  assert.match(atoms, /const streaming = !done && text\.length > 0/);
  // done 后清空独立通道（由 messages 数组接管）
  assert.match(atoms, /delete nextMap\[event\.sessionId\]/);
});

test("IPC channel and preload route wiring", () => {
  const ipc = readFileSync("src/shared/ipc.ts", "utf8");
  assert.match(ipc, /agentsTextStream: "agents:text-stream"/);

  const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
  assert.match(agentManager, /ipcChannels\.agentsTextStream/);
});

// 阶段2：StreamingAnswerBubble 消费独立通道，最后一条流式中间回答走气泡
test("stage2: TurnRow renders streaming bubble for last interim when streaming", () => {
  const turnRow = readFileSync(
    "src/renderer/src/components/session/turn/TurnRow.tsx",
    "utf8",
  );
  assert.match(turnRow, /sessionId\?: string/);
  assert.match(turnRow, /lastInterimId/);
  assert.match(turnRow, /props\.isStreaming &&\s*\n\s*item\.id === lastInterimId/);
  assert.match(turnRow, /<StreamingAnswerBubble/);
  assert.match(turnRow, /import \{ StreamingAnswerBubble \}/);
  assert.match(turnRow, /prev\.sessionId === next\.sessionId/);

  const bubble = readFileSync(
    "src/renderer/src/components/session/turn/StreamingAnswerBubble.tsx",
    "utf8",
  );
  assert.match(bubble, /streamingTextByIdAtom/);
  assert.match(bubble, /useAtomValue\(streamingTextByIdAtom\)/);
  assert.match(bubble, /entry\?\.content \?\? ""/);

  const timeline = readFileSync(
    "src/renderer/src/components/session/SessionMessageTimeline.tsx",
    "utf8",
  );
  assert.match(timeline, /sessionId=\{sessionId\}/);
});
