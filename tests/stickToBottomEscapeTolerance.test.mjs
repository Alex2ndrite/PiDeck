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
  // 上滚逃逸必须带距离守卫：只有距底 > 25px 且越过增长守卫带才解锁锁底
  // （2026-08 追加守卫带，见 growth-guard-band 用例）
  assert.match(
    engineSource,
    /if \(\s*distanceFromBottom > AT_BOTTOM_TOLERANCE_PX &&[\s\S]*?!isWithinGrowthGuardBand\(distanceFromBottom, state\)\s*\) \{\s*setEscapedFromLock\(true\);\s*setIsAtBottom\(false\);/,
  );
  // wheel 逃逸同样带距离守卫（贴底时向上滚轮无位移，不算逃逸意图）
  assert.match(
    engineSource,
    /scrollRef\.current\.scrollHeight -\s*scrollRef\.current\.scrollTop -\s*scrollRef\.current\.clientHeight >\s*AT_BOTTOM_TOLERANCE_PX/,
  );
});

// 用户反馈 bug：流式渲染「推着推着就不动了」，只能手动点回底按钮。
// 根因：流式逐行增高时弹簧追底存在物理滞后（scrollTop 落后 target 数十到上百 px，
// 距底远超 25px 容差带），此时用户/触控板轻微上滚（含惯性误触）被误判为逃逸，
// 之后内容增长不再跟随，且 turn 窗口 3→15 轮展开放大为「视口突然停住」。
// 修复：最后一次正增长后 500ms 内、距底 <= 200px 的上滚视为「仍在跟随」，
// 不逃逸；流式结束约 500ms 后恢复正常逃逸语义；距底更远的上滚（明确读历史）
// 即使流式中也立即逃逸，不被长时间锁死。
test("growth guard band blocks escape while streaming lags behind", () => {
  // 守卫常量：500ms 锁定窗口 + 200px 守卫带
  assert.match(engineSource, /const POSITIVE_RESIZE_ESCAPE_LOCKOUT_MS = 500;/);
  assert.match(engineSource, /const GROWTH_ESCAPE_GUARD_PX = 200;/);
  // 判定辅助函数：距底 <= 守卫带 && 距上次正增长 < 锁定窗口
  assert.match(
    engineSource,
    /function isWithinGrowthGuardBand\([\s\S]*?distanceFromBottom <= GROWTH_ESCAPE_GUARD_PX &&\s*performance\.now\(\) - state\.lastPositiveResizeAt < POSITIVE_RESIZE_ESCAPE_LOCKOUT_MS/,
  );
  // 任何正增长（流式渲染）都刷新锁定计时
  assert.match(engineSource, /state\.lastPositiveResizeAt = performance\.now\(\);/);
  // 两处逃逸（scroll / wheel）都必须越过守卫带才生效
  assert.match(
    engineSource,
    /isWithinGrowthGuardBand\(distanceFromBottom, state\)/,
  );
  assert.match(engineSource, /!isWithinGrowthGuardBand\(/);
});

// 逃逸兜底：无论逃逸由哪条路径触发（误判/拖选/程序化），只要用户没滚远
// （距底仍 <= 70px 近底带），内容正增长时自动恢复锁底并继续追底——
// 即使误逃逸已发生，也无需手动点回底按钮即可自愈。
test("near-bottom escape auto re-locks on content growth", () => {
  assert.match(
    engineSource,
    /if \(!state\.isAtBottom && state\.isNearBottom\) \{\s*setEscapedFromLock\(false\);\s*setIsAtBottom\(true\);/,
  );
  // 自动恢复必须位于正增长分支的动画/贴底动作之前：instant 分支与
  // scrollToBottom 都以 state.isAtBottom 决定是否执行，先重锁才能追底
  assert.match(
    engineSource,
    /if \(!state\.isAtBottom && state\.isNearBottom\) \{[\s\S]*?setIsAtBottom\(true\);\s*\}[\s\S]*?const requested = mergeAnimations\(/,
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
