import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scrollerSource = readFileSync(
  "src/renderer/src/components/agents/message-scroller.tsx",
  "utf8",
);
const engineSource = readFileSync(
  "src/renderer/src/lib/stick-to-bottom/useStickToBottom.ts",
  "utf8",
);

// 用户反馈 bug：点击「收起思考」后视口突兀弹到最底端。
// 根因（旧手写实现）：ResizeObserver 对内容「收缩」也触发跟随滚动（scrollToEnd smooth）。
// 换用 use-stick-to-bottom 引擎后，该语义由引擎内置：只有内容「增长」才锁底跟随，
// 收缩（negative resize）只保留当前视口，不主动滚动。
test("follow scroll only on content growth, not on shrink", () => {
  // 引擎在 ResizeObserver 回调里区分正/负 resize：增长才 scrollToBottom
  assert.match(engineSource, /const difference = height - \(previousHeight \?\? height\);/);
  assert.match(engineSource, /if \(difference >= 0\) \{/);
  // 收缩（negative resize）：不主动滚动，仅在已近底时维持锁底状态
  assert.match(engineSource, /if \(state\.isNearBottom\) \{/);
  // 增长时追底保留期（350ms）与弹簧物理由引擎管理，避免"收缩弹到底"的旧 bug
  assert.match(engineSource, /RETAIN_ANIMATION_DURATION_MS/);
});

// needsInstant 过渡窗口（busy true→false 后 150ms）：期间追底用 instant，
// 避免流式结束时最终文本长高触发平滑滚动动画造成跳屏。
test("needsInstant window forces instant resize after stream ends", () => {
  // MessageScroller 用 state 跟踪 busy 结束窗口（必须 state，resize 需随渲染更新）
  assert.match(scrollerSource, /const \[busyEnding, setBusyEnding\] = useState\(false\)/);
  assert.match(
    scrollerSource,
    /resize: busyEnding \|\| reduce \|\| !smooth \? "instant" : "smooth"/,
  );
  // 150ms 后关闭窗口
  assert.match(scrollerSource, /setTimeout\(\(\) => \{\s*setBusyEnding\(false\);\s*\}, 150\)/);
});

// 跟随开关（followOutput）与用户逃逸/回底（onFollowChange）桥接到引擎：
// - followOutput=true 时重新锁底（instant）
// - 引擎 isAtBottom 变化时上报给 controller，controller 再回写 followOutput
test("followOutput and onFollowChange bridge to the stick engine", () => {
  assert.match(scrollerSource, /const engineScrollToBottom = stick\.scrollToBottom;/);
  assert.match(scrollerSource, /if \(!followOutput\) return;/);
  assert.match(scrollerSource, /engineScrollToBottom\(\{ animation: "instant" \}\)/);
  assert.match(scrollerSource, /onFollowChange\?\.\(isFollowing\)/);
  assert.match(scrollerSource, /const isFollowing = engineIsAtBottom;/);
  // 引擎自带 wheel 逃逸：向上滚（deltaY<0）时脱离锁底
  assert.match(engineSource, /deltaY < 0/);
  assert.match(engineSource, /setEscapedFromLock\(true\)/);
});
