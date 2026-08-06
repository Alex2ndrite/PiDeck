import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("FileDiffViewer: view mode defaults to editable, diff mode stays read-only", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  // 默认编辑模式：view 打开即可编辑，无需先点「编辑」按钮
  assert.match(viewer, /useState\(\(\) => props\.mode === "diff"\)/);
  // tab 切换重置：view 可编辑、diff 只读（历史提交 Diff 不能误带编辑状态）
  assert.match(viewer, /setReadOnly\(isDiffMode\)/);
  // markdown 默认显示源码（可编辑），预览改为手动切换
  assert.match(viewer, /const \[preview, setPreview\] = useState\(false\)/);
  assert.match(viewer, /setPreview\(false\)/);
  // 编辑/退出按钮在预览态隐藏（预览是只读展示，不混入编辑控件）
  assert.match(viewer, /props\.saveContent && readOnly && !preview/);
  assert.match(viewer, /!readOnly && props\.saveContent && !preview/);
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

test("FileDiffViewer: image/PDF get inline preview instead of binary error", () => {
  const viewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  const textFile = readFileSync("src/renderer/src/utils/isTextFile.ts", "utf8");
  // 判定函数：图片/PDF 从二进制集合中单独识别
  assert.match(textFile, /export function isImageFile/);
  assert.match(textFile, /export function isPdfFile/);
  assert.match(textFile, /IMAGE_EXTENSIONS = new Set/);
  // view 模式图片/PDF 跳过文本读取直接预览；diff 模式维持不支持提示
  assert.match(viewer, /!isDiffMode && \(isImageFile\(props\.filePath\) \|\| isPdfFile\(props\.filePath\)\)/);
  // 图片：img + file:// URL（CSP img-src 已含 file:）；PDF：iframe + Chromium 内置 viewer
  assert.match(viewer, /className="file-diff-media-preview"/);
  assert.match(viewer, /toFileUrl\(props\.filePath\)/);
  assert.match(viewer, /className="file-diff-pdf-preview"/);
  assert.match(viewer, /editor\.pdfPreview/);
  // file:// URL 构造：反斜杠转正斜杠 + encodeURI
  assert.match(viewer, /encodeURI\(path\.replace/);
  // CSP 允许 frame-src file:（PDF iframe 加载本地文件）
  const html = readFileSync("src/renderer/index.html", "utf8");
  assert.match(html, /frame-src 'self' file: blob:/);
});
