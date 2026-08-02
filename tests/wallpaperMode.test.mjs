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
  // token 半透明注入（静态色值 + color-mix，覆盖所有面板/输入框）
  assert.match(
    appSource,
    /for \(const k of BG_TOKENS\)/,
  );
  assert.match(appSource, /80%, transparent/);
});
