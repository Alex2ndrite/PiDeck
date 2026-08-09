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
// busy 本身在 agent 忙碌（含工具执行）期间也强制 instant，避免工具卡弹出弹簧滞后砰抖。
test("needsInstant window forces instant resize after stream ends", () => {
  // MessageScroller 用 state 跟踪 busy 结束窗口（必须 state，resize 需随渲染更新）
  assert.match(scrollerSource, /const \[busyEnding, setBusyEnding\] = useState\(false\)/);
  assert.match(
    scrollerSource,
    /resize: busy \|\| busyEnding \|\| reduce \|\| !smooth \? "instant" : "smooth"/,
  );
  // 150ms 后关闭窗口
  assert.match(scrollerSource, /setTimeout\(\(\) => \{\s*setBusyEnding\(false\);\s*\}, 150\)/);
});

// 内容单次增高超过阈值时强制 instant，避免工具卡等离散跳变走弹簧造成「砰」抖。
test("large positive resize forces instant follow", () => {
  assert.match(engineSource, /instantResizeThreshold/);
  assert.match(engineSource, /difference > threshold/);
  assert.match(scrollerSource, /instantResizeThreshold:\s*28/);
});

// instant 增高必须在 ResizeObserver 回调内同步写 scrollTop，不能再丢进下一帧 rAF。
test("instant positive resize corrects scrollTop synchronously in ResizeObserver", () => {
  assert.match(engineSource, /if \(animation === "instant"\) \{/);
  assert.match(
    engineSource,
    /state\.scrollTop = state\.calculatedTargetScrollTop;/,
  );
  // 同步路径会 bump generation 并清掉在途 animation，避免阶梯追赶
  assert.match(engineSource, /state\.scrollGeneration \+= 1;/);
  // 弹簧路径仍走 scrollToBottom；instant 不再经 wait:true 短路
  assert.match(
    engineSource,
    /if \(animation === "instant"\) \{[\s\S]*?\} else \{\s*scrollToBottom\(/,
  );
});

// mergeAnimations 缓存 key 必须区分 instant / spring。
test("mergeAnimations cache key includes instant flag", () => {
  const mergeSource = readFileSync(
    "src/renderer/src/lib/stick-to-bottom/mergeAnimations.ts",
    "utf8",
  );
  assert.match(
    mergeSource,
    /const key = `\$\{instant \? "instant" : "spring"\}:\$\{JSON\.stringify\(result\)\}`;/,
  );
});

// 时间线把整段 agent 忙碌传给 scroller busy，不只「等待首条助手」窗口。
test("timeline marks scroller busy for full agent run", () => {
  const timelineSource = readFileSync(
    "src/renderer/src/components/session/SessionMessageTimeline.tsx",
    "utf8",
  );
  assert.match(timelineSource, /busy=\{isAgentBusy \|\| isAwaitingAssistant\}/);
});

// 工具卡入场仅淡入（可有 opacity animation），禁止位移。
test("tool enter animation has no translateY", () => {
  const cssSource = readFileSync("src/renderer/src/styles/timeline.css", "utf8");
  assert.match(cssSource, /@keyframes timeline-step-enter \{[\s\S]*?from \{\s*opacity: 0;\s*\}/);
  // 去掉注释后再断言，避免注释里的 translateY 字样误伤
  const enterBlock = cssSource.match(
    /@keyframes timeline-step-enter \{[\s\S]*?\n\}/,
  );
  assert.ok(enterBlock, "expected timeline-step-enter keyframes");
  const withoutComments = enterBlock[0].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(withoutComments, /transform\s*:/);
  assert.doesNotMatch(withoutComments, /translateY\s*\(/);
  assert.doesNotMatch(
    cssSource,
    /\.tool-group-card:has\(\.tool-card--running\)\s*\{/,
  );
});

// 跟随开关（followOutput）与用户逃逸/回底（onFollowChange）桥接到引擎：
// - followOutput=true 时重新锁底（近底 instant / 远处弹簧）
// - 引擎 isAtBottom 变化时上报给 controller，controller 再回写 followOutput
test("followOutput and onFollowChange bridge to the stick engine", () => {
  assert.match(scrollerSource, /const engineScrollToBottom = stick\.scrollToBottom;/);
  assert.match(scrollerSource, /if \(!followOutput\) return;/);
  assert.match(scrollerSource, /engineScrollToBottom\(\{ animation \}\)/);
  assert.match(
    scrollerSource,
    /reduce \|\| distance <= followThreshold \? "instant" : "smooth"/,
  );
  assert.match(scrollerSource, /onFollowChange\?\.\(isFollowing\)/);
  assert.match(scrollerSource, /const isFollowing = engineIsAtBottom;/);
  // 引擎自带 wheel 逃逸：向上滚（deltaY<0）时脱离锁底
  assert.match(engineSource, /deltaY < 0/);
  assert.match(engineSource, /setEscapedFromLock\(true\)/);
});

// 会话切换恢复历史位置：引擎必须提供「原子恢复」——定位 + 解锁锁底 + 取消在途动画
// 一次完成。若只做原生 scrollTop 赋值，busy 会话的 ResizeObserver（instant 贴底）
// 会抢先于异步 scroll 解锁事件，把恢复的位置立刻拽回底部（双真相源竞态）。
test("engine exposes atomic restoreAt: position + unlock + cancel in-flight animation", () => {
  // 引擎 API：restoreAt 在返回的实例上（controller 通过 scrollApiRef 调用）
  assert.match(engineSource, /export type RestoreAt = \(scrollTop: number\) => void;/);
  assert.match(engineSource, /const restoreAt = useCallback\(\(scrollTop: number\) => \{/);
  // 原子三件事：取消在途动画（generation++ / animation 清空）→ 解锁（escapedFromLock/isAtBottom）
  assert.match(engineSource, /state\.scrollGeneration \+= 1;/);
  assert.match(engineSource, /state\.animation = undefined;/);
  assert.match(engineSource, /setEscapedFromLock\(true\);/);
  assert.match(engineSource, /setIsAtBottom\(false\);/);
  // 定位走 state.scrollTop setter（写 DOM 并设置 ignoreScrollToTop，后续 scroll 事件被忽略）
  assert.match(engineSource, /state\.scrollTop = Math\.max\(0, scrollTop\);/);
  assert.match(engineSource, /restoreAt,/);
});

test("MessageScroller forwards restoreAt to timeline controller scroll api", () => {
  // MessageScrollerScrollApi 类型与 api 挂载都要包含 restoreAt
  assert.match(scrollerSource, /restoreAt: \(scrollTop: number\) => void;/);
  assert.match(scrollerSource, /const engineRestoreAt = stick\.restoreAt;/);
  assert.match(scrollerSource, /restoreAt: engineRestoreAt,/);
});

test("timeline controller restores via engine restoreAt and keeps negative offset", () => {
  const source = readFileSync(
    "src/renderer/src/hooks/useSessionTimelineController.ts",
    "utf8",
  );
  // 保存锚点保留负偏移（视口顶部常被上一行底部占据，截断会导致恢复位置偏下）
  assert.match(source, /offsetTop: rect\.top - viewportRect\.top,/);
  assert.doesNotMatch(source, /offsetTop: Math\.max\(0, rect\.top - viewportRect\.top\)/);
  // 恢复走引擎原子 API（引擎未挂上时回退原生定位）
  assert.match(source, /api\?\.restoreAt/);
  assert.match(source, /api\.restoreAt\(targetTop\)/);
  // autoScroll 初始值按锚点决定：有锚点不跟底，避免第一帧滚底再纠正
  assert.match(source, /return !store\.get\(sessionScrollAnchorByIdAtom\)\[sessionId\];/);
});
