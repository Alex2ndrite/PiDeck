import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
const header = readFileSync("src/renderer/src/components/AppHeader.tsx", "utf8");
const ipc = readFileSync("src/shared/ipc.ts", "utf8");
const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");

test("custom titlebar pulls chat pane and drawer flush with sidebar top", () => {
  assert.match(foundation, /\.custom-titlebar-enabled \.chat-pane/);
  assert.match(foundation, /\.custom-titlebar-enabled \.detail-drawer/);
  assert.match(
    foundation,
    /\.custom-titlebar-enabled \.chat-pane,\s*\n\.custom-titlebar-enabled \.detail-drawer \{[\s\S]*?margin-top:\s*calc\(-1 \* var\(--window-drag-height\)\)/,
  );
});

test("window controls are compact and match drag-layer inset", () => {
  assert.match(foundation, /--window-drag-height:\s*32px/);
  assert.match(foundation, /grid-template-columns:\s*repeat\(4,\s*36px\)/);
  assert.match(foundation, /\.window-drag-layer \{[\s\S]*?right:\s*144px/);
});

test("maximize button tracks window state with restore icon", () => {
  assert.match(header, /function RestoreIcon/);
  assert.match(header, /maximized \? <RestoreIcon/);
  assert.match(header, /app\.windowRestore/);
  assert.match(header, /app\.windowMaximize/);
  assert.match(ipc, /appWindowIsMaximized/);
  assert.match(ipc, /appWindowMaximizedChanged/);
  assert.match(systemIpc, /appWindowIsMaximized/);
  assert.match(systemIpc, /win\.on\("maximize"/);
  assert.match(systemIpc, /win\.on\("unmaximize"/);
  assert.match(preload, /isWindowMaximized:/);
  assert.match(preload, /onWindowMaximizedChange:/);
  assert.match(preload, /toggleMaximizeWindow:[\s\S]*Promise<boolean>/);
});
