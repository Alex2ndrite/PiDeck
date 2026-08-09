import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("FileDiffViewer: view mode defaults to editable, diff mode stays read-only", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  // 默认编辑模式：view 打开即可编辑，无需先点「编辑」按钮
  assert.match(viewer, /useState\(\(\) => props\.mode === "diff"\)/);
  // tab 切换重置：view 可编辑、diff 只读（历史提交 Diff 不能误带编辑状态）
  assert.match(viewer, /setReadOnly\(isDiffMode\)/);
  // markdown/html/svg 打开默认预览模式，点「源码」切换才进入编辑态；tab 切换同样重置为默认预览
  assert.match(viewer, /const defaultPreview = !isDiffMode && \(isMarkdown \|\| isHtml \|\| isSvg\)/);
  assert.match(viewer, /useState\(defaultPreview\)/);
  assert.match(viewer, /setPreview\(defaultPreview\)/);
  // 编辑/退出按钮仅保留给 diff 模式（历史对比默认只读）：view 模式源码即编辑，不混入独立编辑控件
  assert.match(viewer, /isDiffMode && props\.saveContent && readOnly && !preview/);
  assert.match(viewer, /isDiffMode && !readOnly && props\.saveContent && !preview/);
});

test("FileDiffViewer: debounced auto-save with Ctrl+S immediate save", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  // 自动保存：编辑停止 500ms 后落盘（saveContent 存在时）；内容未变跳过
  assert.match(viewer, /scheduleAutoSave/);
  assert.match(viewer, /setTimeout\(\(\) => \{\n\s*saveTimerRef\.current = null;/);
  assert.match(viewer, /500\);/);
  assert.match(viewer, /lastSavedRef\.current/);
  assert.match(viewer, /if \(latest === lastSavedRef\.current\) return/);
  // 加载完成即建立「已落盘」基准，避免打开后无改动就写盘
  assert.match(viewer, /lastSavedRef\.current = result/);
  // Ctrl+S 立即保存（取消挂起 timer），卸载清理 timer（生命周期配对）
  assert.match(viewer, /void saveNow\(\);/);
  assert.match(viewer, /clearTimeout\(saveTimerRef\.current\)/);
});

test("editors bind Ctrl+/ comment toggle and JSON lint", () => {
  const editor = readFileSync("src/renderer/src/components/app/CodeMirrorEditor.tsx", "utf8");
  const merge = readFileSync("src/renderer/src/components/app/MergeDiffView.tsx", "utf8");
  // Ctrl+/ 注释/取消注释（@codemirror/commands 的 toggleComment）
  assert.match(editor, /import \{[^}]*toggleComment/);
  assert.match(editor, /Mod-\//);
  assert.match(merge, /Mod-\//);
  // JSON 语法错误即时提示（lintGutter + jsonParseLinter，仅 json/jsonc）
  assert.match(editor, /lintGutter\(\), linter\(jsonParseLinter\(\)\)/);
  assert.match(editor, /resolvedLanguage\.language\.name === "json"/);
});

test("FileDiffViewer: image/PDF get inline preview via base64 Blob URL", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  const textFile = readFileSync("src/renderer/src/utils/isTextFile.ts", "utf8");
  const ipc = readFileSync("src/main/ipc/filesIpc.ts", "utf8");
  // 判定函数：图片/PDF 从二进制集合中单独识别
  assert.match(textFile, /export function isImageFile/);
  assert.match(textFile, /export function isPdfFile/);
  assert.match(textFile, /IMAGE_EXTENSIONS = new Set/);
  // view 模式图片/PDF 走二进制预览分支；diff 模式维持不支持提示
  assert.match(viewer, /!isDiffMode && \(isImageFile\(props\.filePath\) \|\| isPdfFile\(props\.filePath\)\)/);
  // 不用 file:// 直链：dev 模式 http 页面加载 file:// 子资源会被 Chromium webSecurity 拦截
  // （"Not allowed to load local resource"）；改为主进程读 base64 → Blob URL
  assert.doesNotMatch(viewer, /file:\/\/\//);
  assert.match(viewer, /readBase64/);
  assert.match(viewer, /URL\.createObjectURL/);
  assert.match(viewer, /URL\.revokeObjectURL/);
  assert.match(viewer, /mimeFromImageExt/);
  assert.match(viewer, /className="file-diff-media-preview"/);
  assert.match(viewer, /className="file-diff-pdf-preview"/);
  assert.match(viewer, /editor\.pdfPreview/);
  // 主进程 handler：读文件转 base64，ENOENT 返回空串（渲染层走「不支持」提示）
  assert.match(ipc, /filesReadBase64/);
  assert.match(ipc, /buffer\.toString\("base64"\)/);
  assert.match(ipc, /code === "ENOENT"/);
});

test("FileDiffViewer: SVG preview via content data URL, media fills the pane", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  const css = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
  // SVG 是文本（可编辑），预览按钮与 md/html 同待遇；预览渲染为 data URL 图片
  assert.match(viewer, /const isSvg = ext === "svg"/);
  assert.match(viewer, /\(isMarkdown \|\| isHtml \|\| isSvg\) && !isDiffMode/);
  assert.match(viewer, /data:image\/svg\+xml;charset=utf-8/);
  assert.match(viewer, /encodeURIComponent\(content\)/);
  // 图片占满预览区：width/height 100% + contain（小图放大、大图缩小、不变形）
  assert.match(css, /\.file-diff-media-preview img \{\n\s*\/\* 占满预览区/);
  assert.match(css, /width: 100%;\n\s*height: 100%;\n\s*object-fit: contain;/);
});
