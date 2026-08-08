import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// UI 2.0（#115 U2）：Streamdown 为唯一 markdown 引擎，内置能力交给官方插件。
// 2026-08 曾因内存移除 @streamdown/code（shiki 双主题 + 全语言 grammar 常驻），
// 2026-08 恢复：@streamdown/code 1.x 为 JS 引擎 + 按语言懒加载（不复现全语言常驻），
// 代码块不再包 details 折叠（Chrome 中文会露出默认「详情」disclosure）。
// 锚点：mermaid/math 由 @streamdown/* 插件接管；a 仍走 MarkdownLink
// （file:// 打开 + 系统浏览器）；Tailwind 已扫描 streamdown 类名保证控件样式完整。
const stream = readFileSync("src/renderer/src/components/session/MarkdownStream.tsx", "utf8");
const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const link = readFileSync("src/renderer/src/components/session/MarkdownLink.tsx", "utf8");
const linkCore = readFileSync("src/renderer/src/components/session/MarkdownLinkCore.ts", "utf8");
const tailwind = readFileSync("src/renderer/src/styles/tailwind.css", "utf8");
const main = readFileSync("src/renderer/src/main.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const surfacesCss = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");

test("streamdown pipeline delegates to official plugins (code/mermaid/math) and keeps link override", () => {
  // 官方插件接管：代码高亮、mermaid、数学
  assert.match(stream, /import \{ code \} from "@streamdown\/code"/);
  assert.match(stream, /import \{ mermaid \} from "@streamdown\/mermaid"/);
  assert.match(stream, /import \{ math \} from "@streamdown\/math"/);
  assert.match(stream, /plugins=\{\s*\(effectiveLight/);
  assert.match(stream, /\{ math \}/);
  // 非 light 分支注册 code 插件；light（更新日志等轻场景）保持无高亮
  assert.match(stream, /\bcode,\n/);
  // 不再用 details 折叠代码块（会露出浏览器默认「详情」）；行号沿用 streamdown 默认开启
  assert.doesNotMatch(stream, /collapseCodeBlocks/);
  assert.doesNotMatch(stream, /lineNumbers=\{false\}/);
  // 链接覆盖保留（file:// 打开 + 外链拦截是项目核心能力）
  assert.match(stream, /a: \(linkProps\) =>/);
  assert.match(stream, /MarkdownLink/);
  assert.match(stream, /remarkLinkifyPaths/);
  // 自定义 pre/span 覆盖移除：mermaid 由插件渲染、公式由 math 插件
  assert.doesNotMatch(stream, /pre: \(preProps\) => <CodeBlock/);
  assert.doesNotMatch(stream, /span: \(spanProps\) => <MathSpan/);
  // 流式也走 static：streaming 模式的 useTransition 会合并帧导致蹦字
  assert.match(stream, /mode="static"/);
  assert.doesNotMatch(stream, /mode=\{props\.isStreaming \? "streaming" : "static"\}/);
  // mermaid 主题跟随明暗
  assert.match(stream, /theme: isDark \? "dark" : "default"/);
});

test("streamdown code/table chrome uses faded action controls", () => {
  const streamdownChrome = readFileSync("src/renderer/src/styles/streamdownChrome.css", "utf8");
  assert.match(streamdownChrome, /\[data-streamdown="code-block-actions"\]/);
  assert.match(streamdownChrome, /opacity:\s*0\.5/);
  assert.match(streamdownChrome, /\[data-streamdown="code-block"\]:hover \[data-streamdown="code-block-actions"\]/);
  assert.match(streamdownChrome, /\[data-streamdown="code-block-copy-button"\][\s\S]*?order:\s*1/);
  assert.match(streamdownChrome, /\[data-streamdown="code-block-download-button"\][\s\S]*?order:\s*2/);
  // 表格与代码块同皮（utilities 层）
  assert.match(streamdownChrome, /\[data-streamdown="table-wrapper"\]:hover > div:first-child/);
  assert.doesNotMatch(surfacesCss, /\.sd-code-collapse\b/);
  assert.doesNotMatch(streamdownChrome, /\.sd-code-collapse\b/);
});

test("Tailwind scans streamdown + plugin classes; styles.css imports vendor streamdown layer", () => {
  assert.match(tailwind, /@source "\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/streamdown\/dist\/\*\.js"/);
  // @streamdown/code 已恢复（JS 引擎懒加载高亮），继续扫描其类名
  assert.match(tailwind, /@source "\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@streamdown\/code\/dist\/\*\.js"/);
  assert.match(tailwind, /@source "\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@streamdown\/mermaid/);
  assert.match(tailwind, /@source "\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@streamdown\/math/);
  // streamdown 经 styles.css layer(vendor) 引入，避免 unlayered 压过 surfaces 覆盖
  const stylesEntry = readFileSync("src/renderer/src/styles.css", "utf8");
  assert.match(stylesEntry, /@import\s+"streamdown\/styles\.css"\s+layer\(vendor\)/);
  assert.doesNotMatch(main, /import "streamdown\/styles\.css"/);
  // 高亮插件进 devDependencies（渲染层依赖随 vite 打包，与分支重构模式一致）
  assert.match(packageJson, /"@streamdown\/code"/);
  assert.match(packageJson, /"@streamdown\/mermaid"/);
  assert.match(packageJson, /"@streamdown\/math"/);
  // shiki 不作为直接依赖出现（由 @streamdown/code 传递引入）；react-markdown 不可回归
  assert.doesNotMatch(packageJson, /"shiki"/);
  assert.doesNotMatch(packageJson, /"react-markdown"/);
});

test("link handling is the single shared implementation (no react-markdown import)", () => {
  // 单份实现：所有管线从共享模块 import，不允许本地重复定义
  assert.match(surface, /from "\.\/MarkdownStream"/);
  assert.doesNotMatch(surface, /function MarkdownLink\(/);
  assert.doesNotMatch(surface, /const remarkLinkifyPaths = /);
  assert.match(link, /export function MarkdownLink/);
  // 纯逻辑（remarkLinkifyPaths/FILE_PATH_RE/isLocalPathRef）在 MarkdownLinkCore.ts
  assert.match(linkCore, /export const remarkLinkifyPaths/);
  assert.match(linkCore, /export function isLocalPathRef/);
  assert.match(link, /from "\.\/MarkdownLinkCore"/);
  assert.match(linkCore, /export function markdownUrlTransform/);
  // 链接安全过滤已本地复刻，不再依赖 react-markdown 包
  assert.match(linkCore, /export function defaultUrlTransform/);
  assert.doesNotMatch(linkCore, /from "react-markdown"/);
});

test("Streamdown is the only markdown engine (switch, settings field, dependency removed)", () => {
  // AssistantText 无开关分流，直接渲染 MarkdownStream
  assert.doesNotMatch(surface, /useStreamdownRendererAtom/);
  assert.doesNotMatch(surface, /ReactMarkdown/);
  assert.doesNotMatch(surface, /from "react-markdown"/);
  assert.match(surface, /<MarkdownStream/);
});

test("static markdown scenes share the Streamdown engine", () => {
  const diffViewer = readFileSync("src/renderer/src/components/app/FileDiffViewer.tsx", "utf8");
  const updateOverlay = readFileSync("src/renderer/src/components/overlays/AppUpdateOverlay.tsx", "utf8");
  const scratchPad = readFileSync("src/renderer/src/components/scratchPad/ScratchPadPanel.tsx", "utf8");
  assert.doesNotMatch(diffViewer, /ReactMarkdown/);
  assert.doesNotMatch(updateOverlay, /ReactMarkdown/);
  assert.doesNotMatch(scratchPad, /ReactMarkdown/);
  assert.match(diffViewer, /MarkdownStream/);
  assert.match(updateOverlay, /MarkdownStream/);
  assert.match(scratchPad, /MarkdownStream/);
  // 静态场景保留各自插件（草稿本的高亮 mark 与 GFM task list 覆盖）
  assert.match(scratchPad, /rehypeHighlightMark/);
  assert.match(scratchPad, /remarkBreaks/);
});
