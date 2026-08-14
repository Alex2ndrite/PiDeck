import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 更新检查只允许设置页手动触发；禁用开关打开后不再有自动检测定时器，
// 且按钮在禁用时不得再显示 loading（检查状态未落定前仍会转圈）。
test("app update check is manual-only and never runs while disabled", () => {
  const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
  const modalSource = readFileSync(
    "src/renderer/src/components/app/SettingsModal.tsx",
    "utf8",
  );

  // 旧实现：启动 5s + 每 6h 自动检测；setTimeout 未存引用，切禁用时旧定时器照跑。
  assert.doesNotMatch(appSource, /check\("auto"\)/, "auto check must not be scheduled");
  assert.doesNotMatch(
    appSource,
    /1000 \* 60 \* 60 \* 6/,
    "periodic auto check timer must not exist",
  );

  // 手动按钮：禁用时 onClick 为空且 loading 不显示（检查可能仍在途，但 UI 不得转圈）。
  assert.match(
    modalSource,
    /onClick=\{draftSettings\.disableUpdateCheck \? undefined : props\.onCheckUpdate\}/,
  );
  assert.match(
    modalSource,
    /loading=\{props\.updateChecking && !draftSettings\.disableUpdateCheck\}/,
  );
  assert.match(modalSource, /disabled=\{draftSettings\.disableUpdateCheck\}/);
});
