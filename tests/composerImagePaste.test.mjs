import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dataUrlToFile,
  imageMimeTypeFromPath,
  isImageFilePath,
} from "../src/renderer/src/utils/composerImages.ts";

/**
 * 会话附件两条修复的回归测试：
 * 1) 附件选择器默认只选文件（Windows 上 openFile+openDirectory 并存会退化「只选文件夹」）；
 * 2) 复制图片文件粘贴 → 附加图片预览，失败回退 @path 引用。
 */

// ── 纯函数：图片路径判定 / MIME 推导 / dataURL→File ──

test("isImageFilePath 识别受支持图片扩展名（大小写/空格/多段扩展名）", () => {
  assert.equal(isImageFilePath("C:\\Users\\me\\Pictures\\shot.PNG"), true);
  assert.equal(isImageFilePath("/home/me/photo.jpeg"), true);
  assert.equal(isImageFilePath("/home/me/a b.webp"), true);
  assert.equal(isImageFilePath("C:\\Users\\me\\archive.tar.png"), true);
  assert.equal(isImageFilePath("/home/me/doc.txt"), false);
  assert.equal(isImageFilePath("/home/me/photo.bmp"), false);
  assert.equal(isImageFilePath("/home/me/noext"), false);
  assert.equal(isImageFilePath("C:\\Users\\me\\folder"), false);
});

test("imageMimeTypeFromPath 按扩展名推导 MIME", () => {
  assert.equal(imageMimeTypeFromPath("a.png"), "image/png");
  assert.equal(imageMimeTypeFromPath("a.jpg"), "image/jpeg");
  assert.equal(imageMimeTypeFromPath("a.JPEG"), "image/jpeg");
  assert.equal(imageMimeTypeFromPath("a.gif"), "image/gif");
  assert.equal(imageMimeTypeFromPath("a.webp"), "image/webp");
  assert.equal(imageMimeTypeFromPath("a.unknown"), "image/png");
});

test("dataUrlToFile 解码 base64 字节、MIME 与文件名正确", async () => {
  // base64("ABC") = QUJD
  const file = dataUrlToFile("data:image/png;base64,QUJD", "image/png", "shot.png");
  assert.equal(file.name, "shot.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 3);
  assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), [65, 66, 67]);
});

// ── 源码级接线断言：对话框 properties 与粘贴分支 ──

const filesIpc = readFileSync("src/main/ipc/filesIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const controller = readFileSync(
  "src/renderer/src/hooks/useSessionComposerController.ts",
  "utf8",
);

test("附件选择器默认仅选文件，includeDirectories 才同时选目录", () => {
  // 默认 properties 不含 openDirectory（Windows 上并存会退化为「只选文件夹」）
  assert.match(
    filesIpc,
    /properties: options\?\.includeDirectories\s*\?\s*\["openFile", "openDirectory", "multiSelections"\]\s*:\s*\["openFile", "multiSelections"\]/,
  );
  assert.match(
    preload,
    /pickFiles: \(options\?:\s*\{ title\?: string; includeDirectories\?: boolean \}\)/,
  );
});

test("readBase64 支持 maxBytes 预检，粘贴图片超大时主进程拦截", () => {
  assert.match(filesIpc, /filesReadBase64, async \(_event, path: string, maxBytes\?: number\)/);
  assert.match(filesIpc, /FILE_TOO_LARGE/);
  assert.match(preload, /readBase64: \(path: string, maxBytes\?: number\)/);
});

test("onPaste 图片文件走预览分支，失败回退 @path 引用", () => {
  assert.match(controller, /clipboardPaths\.every\(isImageFilePath\)/);
  assert.match(controller, /pasteClipboardImages/);
  assert.match(controller, /readBase64\(path, COMPOSER_IMAGE_MAX_BYTES\)/);
  assert.match(controller, /insertFilePathRefs\(paths\)/);
});
