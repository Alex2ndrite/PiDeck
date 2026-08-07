import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/renderer/src/components/agents/message-scroller.tsx",
  "utf8",
);

// 用户反馈 bug：点击「收起思考」后视口突兀弹到最底端。
// 根因：ResizeObserver 对内容「收缩」也触发跟随滚动（scrollToEnd smooth）。
// 修复：记录内容上次高度，只在内容增长时跟随，收缩时视口保持不动。
test("follow scroll only on content growth, not on shrink", () => {
  // 记录上一次内容高度，作为增长判断基准
  assert.match(source, /lastContentHeight = \{ current: content\.clientHeight \}/);
  // 仅在高度增长时执行 scrollToEnd
  const observerCallback = source.match(
    /const observer = new ResizeObserver\(\(entries\) => \{[\s\S]*?\}\);\n    observer\.observe\(content\);/,
  )?.[0] ?? "";
  assert.ok(observerCallback, "ResizeObserver callback must exist");
  assert.match(observerCallback, /if \(height > lastContentHeight\.current\) \{/);
  // 追底 behavior：流式结束过渡窗口（busyEndingRef）内用 instant，否则 smooth/auto
  assert.match(observerCallback, /busyEndingRef\.current \? "auto" : \(reduce \|\| !smooth \? "auto" : "smooth"\)/);
  // 每次回调都同步更新基准高度（后续收缩不触发滚动）
  assert.match(observerCallback, /lastContentHeight\.current = height;/);
  // 跟随开关（followOutput + following）仍然生效
  assert.match(observerCallback, /!followOutput \|\| !followingRef\.current/);
  // 流式结束过渡窗口：busy true→false 后 150ms 内追底用 instant（needsInstant）
  assert.match(source, /busyEndingRef = useRef\(false\)/);
  assert.match(source, /setTimeout\(\(\) => \{\s*busyEndingRef\.current = false;\s*\}, 150\)/);
});
