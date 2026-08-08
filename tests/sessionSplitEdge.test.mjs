import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const edgeSrc = readFileSync("src/renderer/src/utils/sessionSplitEdge.ts", "utf8");
const stage = readFileSync("src/renderer/src/components/session/SessionSplitStage.tsx", "utf8");
const tabs = readFileSync("src/renderer/src/components/session/SessionTabsBar.tsx", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");

/** 与 sessionSplitEdge.ts 保持同步的纯函数副本（契约测试）。 */
function resolveSessionSplitEdge(clientX, clientY, rect, thresholdRatio = 0.28) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const distLeft = x;
  const distRight = 1 - x;
  const distTop = y;
  const distBottom = 1 - y;
  const nearest = Math.min(distLeft, distRight, distTop, distBottom);
  if (nearest > thresholdRatio) return null;
  if (nearest === distLeft) return "left";
  if (nearest === distRight) return "right";
  if (nearest === distTop) return "top";
  return "bottom";
}

function resolveSplitHostSessionId({ currentSessionId, draggedSessionId, tabIds }) {
  if (!draggedSessionId) return null;
  if (currentSessionId && currentSessionId !== draggedSessionId) return currentSessionId;
  const other = tabIds.find((id) => id && id !== draggedSessionId);
  return other ?? null;
}

function buildSplitLayoutFromDrop({ hostSessionId, draggedSessionId, edge }) {
  if (!hostSessionId || !draggedSessionId || hostSessionId === draggedSessionId) return null;
  const orientation = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  if (edge === "left" || edge === "top") {
    return { firstSessionId: draggedSessionId, secondSessionId: hostSessionId, orientation };
  }
  return { firstSessionId: hostSessionId, secondSessionId: draggedSessionId, orientation };
}

function replaceSplitPaneFromDrop({ layout, draggedSessionId, edge }) {
  if (
    !draggedSessionId ||
    draggedSessionId === layout.firstSessionId ||
    draggedSessionId === layout.secondSessionId
  ) {
    return null;
  }
  const orientation = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  if (edge === "left" || edge === "top") {
    return {
      firstSessionId: draggedSessionId,
      secondSessionId: layout.secondSessionId,
      orientation,
    };
  }
  return {
    firstSessionId: layout.firstSessionId,
    secondSessionId: draggedSessionId,
    orientation,
  };
}

function resolveSplitAfterClose(layout, closedSessionId) {
  const firstGone = layout.firstSessionId === closedSessionId;
  const secondGone = layout.secondSessionId === closedSessionId;
  if (!firstGone && !secondGone) return { layout };
  if (firstGone && secondGone) return null;
  if (firstGone) return { soloSessionId: layout.secondSessionId };
  return { soloSessionId: layout.firstSessionId };
}

function replaceSplitPaneFromFocus({ layout, prevFocusedSessionId, nextFocusedSessionId }) {
  if (
    nextFocusedSessionId === layout.firstSessionId ||
    nextFocusedSessionId === layout.secondSessionId
  ) {
    return null;
  }
  if (layout.firstSessionId === prevFocusedSessionId) {
    return { ...layout, firstSessionId: nextFocusedSessionId };
  }
  if (layout.secondSessionId === prevFocusedSessionId) {
    return { ...layout, secondSessionId: nextFocusedSessionId };
  }
  return { ...layout, firstSessionId: nextFocusedSessionId };
}

describe("session split edge resolution", () => {
  const rect = { left: 0, top: 0, width: 1000, height: 800 };

  it("exports shared MIME and helpers from source", () => {
    assert.match(edgeSrc, /SESSION_TAB_DRAG_MIME/);
    assert.match(edgeSrc, /export function resolveSessionSplitEdge/);
    assert.match(edgeSrc, /export function resolveSplitHostSessionId/);
    assert.match(edgeSrc, /export function buildSplitLayoutFromDrop/);
    assert.match(edgeSrc, /export function replaceSplitPaneFromDrop/);
    assert.match(edgeSrc, /export function replaceSplitPaneFromFocus/);
    assert.match(edgeSrc, /export function resolveSplitAfterClose/);
  });

  it("resolves nearest edge inside threshold and ignores center", () => {
    assert.equal(resolveSessionSplitEdge(50, 400, rect), "left");
    assert.equal(resolveSessionSplitEdge(950, 400, rect), "right");
    assert.equal(resolveSessionSplitEdge(500, 40, rect), "top");
    assert.equal(resolveSessionSplitEdge(500, 760, rect), "bottom");
    assert.equal(resolveSessionSplitEdge(500, 400, rect), null);
  });

  it("builds layout with dragged session on drop side", () => {
    assert.deepEqual(
      buildSplitLayoutFromDrop({ hostSessionId: "a", draggedSessionId: "b", edge: "right" }),
      { firstSessionId: "a", secondSessionId: "b", orientation: "horizontal" },
    );
    assert.deepEqual(
      buildSplitLayoutFromDrop({ hostSessionId: "a", draggedSessionId: "b", edge: "left" }),
      { firstSessionId: "b", secondSessionId: "a", orientation: "horizontal" },
    );
    assert.equal(
      buildSplitLayoutFromDrop({ hostSessionId: "a", draggedSessionId: "a", edge: "right" }),
      null,
    );
  });

  it("resolves host so every open tab can initiate split, including the focused one", () => {
    // 拖非当前 → 宿主=当前（第一个 Tab 拖向已聚焦的第二个）
    assert.equal(
      resolveSplitHostSessionId({
        currentSessionId: "b",
        draggedSessionId: "a",
        tabIds: ["a", "b"],
      }),
      "b",
    );
    // 拖当前 → 宿主=另一个 Tab（否则「第二个打开的 Tab」拖边缘无反应）
    assert.equal(
      resolveSplitHostSessionId({
        currentSessionId: "b",
        draggedSessionId: "b",
        tabIds: ["a", "b"],
      }),
      "a",
    );
    // 只有自己 → 无法分屏
    assert.equal(
      resolveSplitHostSessionId({
        currentSessionId: "a",
        draggedSessionId: "a",
        tabIds: ["a"],
      }),
      null,
    );
    // 侧栏拖入尚未在 Tab 栏、但当前已有会话
    assert.equal(
      resolveSplitHostSessionId({
        currentSessionId: "a",
        draggedSessionId: "c",
        tabIds: ["a", "c"],
      }),
      "a",
    );
  });

  it("replaces the edge-side pane when already split", () => {
    const layout = {
      firstSessionId: "a",
      secondSessionId: "b",
      orientation: "horizontal",
    };
    assert.deepEqual(
      replaceSplitPaneFromDrop({ layout, draggedSessionId: "c", edge: "right" }),
      { firstSessionId: "a", secondSessionId: "c", orientation: "horizontal" },
    );
    assert.equal(
      replaceSplitPaneFromDrop({ layout, draggedSessionId: "a", edge: "right" }),
      null,
    );
  });

  it("replaces the pane that held the previous focus when a new session is selected", () => {
    const layout = {
      firstSessionId: "a",
      secondSessionId: "b",
      orientation: "horizontal",
    };
    // 焦点在 a，新建 Agent c → 替换 first 栏（本次 bug 的主路径）
    assert.deepEqual(
      replaceSplitPaneFromFocus({ layout, prevFocusedSessionId: "a", nextFocusedSessionId: "c" }),
      { firstSessionId: "c", secondSessionId: "b", orientation: "horizontal" },
    );
    // 焦点在 b → 替换 second 栏
    assert.deepEqual(
      replaceSplitPaneFromFocus({ layout, prevFocusedSessionId: "b", nextFocusedSessionId: "c" }),
      { firstSessionId: "a", secondSessionId: "c", orientation: "horizontal" },
    );
    // 新会话已在分屏内 → 只切焦点，不改布局
    assert.equal(
      replaceSplitPaneFromFocus({ layout, prevFocusedSessionId: "a", nextFocusedSessionId: "b" }),
      null,
    );
    // 焦点游离（prev 不在任何栏）→ 退化为替换 first 栏，保证新会话可见
    assert.deepEqual(
      replaceSplitPaneFromFocus({ layout, prevFocusedSessionId: "x", nextFocusedSessionId: "c" }),
      { firstSessionId: "c", secondSessionId: "b", orientation: "horizontal" },
    );
    // prev 为 undefined（切项目后直接新建）→ 同样退化为 first 栏
    assert.deepEqual(
      replaceSplitPaneFromFocus({ layout, prevFocusedSessionId: undefined, nextFocusedSessionId: "c" }),
      { firstSessionId: "c", secondSessionId: "b", orientation: "horizontal" },
    );
  });

  it("unsplits when a pane session is closed", () => {
    const layout = {
      firstSessionId: "a",
      secondSessionId: "b",
      orientation: "vertical",
    };
    assert.deepEqual(resolveSplitAfterClose(layout, "a"), { soloSessionId: "b" });
    assert.deepEqual(resolveSplitAfterClose(layout, "b"), { soloSessionId: "a" });
    assert.deepEqual(resolveSplitAfterClose(layout, "x"), { layout });
  });

  it("wires SessionSplitStage, tab drag, i18n and styles", () => {
    assert.match(stage, /session-split-drop-preview/);
    assert.match(stage, /onDragOverCapture/);
    assert.match(stage, /onDropCapture/);
    assert.match(stage, /draggingSessionId && hoverEdge/);
    assert.doesNotMatch(stage, /hostSessionId/);
    assert.match(tabs, /SESSION_TAB_DRAG_MIME/);
    assert.match(tabs, /onDragSessionChange/);
    assert.match(app, /SessionSplitStage/);
    assert.match(app, /ChatSessionPane/);
    assert.match(app, /workspaceChrome\.dropSplit/);
    assert.match(zh, /"session\.split\.preview\.right"/);
    assert.match(en, /"session\.split\.preview\.right"/);
    assert.match(surfaces, /\.session-split-drop-preview-right/);
  });

  it("sidebar sessions share drag MIME and preview/permanent open modes", () => {
    const tree = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
    const injector = readFileSync("src/renderer/src/components/session/SessionRuntimeInjector.tsx", "utf8");
    const chrome = readFileSync("src/renderer/src/hooks/useSessionWorkspaceChrome.ts", "utf8");
    const runtime = readFileSync("src/renderer/src/hooks/useSessionRuntimeController.ts", "utf8");
    const actions = readFileSync("src/renderer/src/hooks/useSessionActions.ts", "utf8");
    assert.match(tree, /SESSION_TAB_DRAG_MIME/);
    assert.match(tree, /onDoubleClick/);
    assert.match(tree, /openSession\(session\.id, "permanent"\)/);
    // chrome 域从 App 抽出，App 只装配；Tab 登记与 selectSession 解耦
    assert.match(app, /useSessionWorkspaceChrome/);
    assert.match(app, /workspaceChrome\.dropSplit/);
    assert.match(app, /registerOpenSession/);
    assert.match(app, /SessionPaneServicesProvider/);
    assert.match(chrome, /export function useSessionWorkspaceChrome/);
    assert.match(chrome, /resolveSplitHostSessionId/);
    assert.match(chrome, /replaceSplitPaneFromFocus/);
    assert.match(chrome, /registerOpenSession/);
    assert.doesNotMatch(actions, /tabMode|onSessionSelected|"keep"/);
    // 分屏栏不再挂右侧抽屉按钮；共享服务走 context；runtime 按 session family 订阅
    assert.match(injector, /useSessionPaneServices/);
    assert.doesNotMatch(injector, /onToggleDrawer|chrome === "full"/);
    assert.match(runtime, /sessionRuntimeBySessionIdAtomFamily\(sessionKey\)/);
    assert.match(runtime, /始终按 sessionId 订阅 family/);
  });
});
