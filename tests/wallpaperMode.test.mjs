import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const css = readRendererStyles();

test("wallpaper mode: background image reveals through translucent panels", () => {
  // 启用背景图时主容器透明（修复前 .wechat-shell 不透明背景盖住 body 背景图）
  assert.match(
    css,
    /:root\[data-bg-image="on"\] \.wechat-shell\s*\{\s*background:\s*transparent;/,
  );
  // body 背景图变量接线
  assert.match(css, /--app-bg-image: none;/);
  assert.match(css, /background-image: var\(--app-bg-mask, none\), var\(--app-bg-image, none\);/);
});

test("App.tsx toggles wallpaper mode marker with background image setting", () => {
  const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
  assert.match(
    appSource,
    /root\.dataset\.bgImage = settings\.backgroundImage \? "on" : "off"/,
  );
  // 皮肤 + 背景图合并为单一 effect（修复互相清除：皮肤 effect 清 token 误清壁纸注入、
  // 背景 else 分支误清皮肤 bg 键）
  assert.match(appSource, /皮肤 \+ 换肤背景图统一管理/);
  // token 半透明注入：面板不透明度跟随滑块（panelMix 与遮罩 alpha 同步，
  // 100% 可见度 → 面板全透明，不再写死 80%）
  assert.match(appSource, /const panelMix = Math\.round\(alpha \* 100\);/);
  // 壁纸模式统一基色（--color-bg-app），侧栏/会话区/抽屉透出完全一致
  assert.match(appSource, /const base = cs\.getPropertyValue\("--color-bg-app"\)\.trim\(\);/);
  assert.match(appSource, /color-mix\(in srgb, \$\{base\} \$\{panelMix\}%, transparent\)/);
  // 只清本 effect 注入过的壁纸 token（模块级记录，不误清皮肤键）
  assert.match(appSource, /injectedWallpaperTokens/);
});
