import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engineSource = readFileSync(
  "src/renderer/src/lib/stick-to-bottom/useStickToBottom.ts",
  "utf8",
);

// 用户反馈 bug：流式回复过程中「滚动到底部」按钮频繁闪现。
// 根因：引擎的上滚逃逸（handleScroll isScrollingUp）与 wheel 逃逸（handleWheel
// deltaY<0）都是无条件解锁锁底——流式回复中滚轮/触控板轻微上滚（含贴底时
// 滚不动但仍产生事件、或上滚不足 25px 仍算在实时尾部附近）会误逃逸，
// 后续内容增长不再贴底，底部按钮随即出现。
// 修复（对照 dsh-web ChatView 的 movedByReader + 距底 <=25px 判定）：
// 两处逃逸都加「距底 > 25px」守卫，距底容差带内（<=25px）的滚动仍视为在底部。
test("escape tolerance band keeps near-bottom scrolls attached", () => {
  // 容差带常量：dsh-web 同值 25px，小于 STICK_TO_BOTTOM_OFFSET_PX（70，近底重锁带）
  assert.match(
    engineSource,
    /const AT_BOTTOM_TOLERANCE_PX = 25;/,
  );
  // 上滚逃逸必须带距离守卫：只有距底 > 25px 才解锁锁底
  assert.match(
    engineSource,
    /if \(distanceFromBottom > AT_BOTTOM_TOLERANCE_PX\) \{\s*setEscapedFromLock\(true\);\s*setIsAtBottom\(false\);/,
  );
  // wheel 逃逸同样带距离守卫（贴底时向上滚轮无位移，不算逃逸意图）
  assert.match(
    engineSource,
    /scrollRef\.current\.scrollHeight -\s*scrollRef\.current\.scrollTop -\s*scrollRef\.current\.clientHeight >\s*AT_BOTTOM_TOLERANCE_PX/,
  );
});

// 逃逸后的重锁语义保持不变：向下滚动回实时尾部（近底 70px 带）仍恢复锁底
test("re-lock path after escape is preserved", () => {
  assert.match(
    engineSource,
    /if \(!state\.escapedFromLock && state\.isNearBottom\) \{\s*setIsAtBottom\(true\);/,
  );
  // 负增长（内容收缩）不主动滚动、不误重锁逃逸用户的守卫仍在
  assert.match(
    engineSource,
    /if \(!state\.escapedFromLock && state\.isNearBottom\) \{\s*setEscapedFromLock\(false\);\s*setIsAtBottom\(true\);/,
  );
});
