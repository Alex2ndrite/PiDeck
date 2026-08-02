import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// UI 2.0（#115 U2）：Streamdown 转正为唯一 markdown 引擎（迁移 react-markdown 完成）。
// 关键点：会话正文与静态场景（文件预览/更新日志/草稿本）共用 MarkdownStream；
// 所有管线共享同一份链接/路径处理实现；react-markdown 依赖与灰度开关已移除。
const stream = readFileSync("src/renderer/src/components/session/MarkdownStream.tsx", "utf8");
const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const link = readFileSync("src/renderer/src/components/session/MarkdownLink.tsx", "utf8");
const linkCore = readFileSync("src/renderer/src/components/session/MarkdownLinkCore.ts", "utf8");
const settingsType = readFileSync("src/shared/types/settings.ts", "utf8");
const atoms = readFileSync("src/renderer/src/atoms/app-ui-atoms.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");

test("streamdown pipeline keeps project overrides (code blocks, file links, math)", () => {
  // 自定义组件覆盖不得回退：mermaid 代码块、文件路径链接、数学 span
  assert.match(stream, /pre: \(preProps\) => <CodeBlock/);
  assert.match(stream, /a: \(linkProps\) =>/);
  assert.match(stream, /MarkdownLink/);
  assert.match(stream, /span: \(spanProps\) => <MathSpan/);
  // 流式容错引擎开启 + 项目自定义插件保留
  assert.match(stream, /mode=\{props\.isStreaming \? "streaming" : "static"\}/);
  assert.match(stream, /remarkLinkifyPaths/);
  assert.match(stream, /remarkMath/);
  assert.match(stream, /rehypeKatex/);
  // file:// 链接放行（sanitize 被有意排除，见组件注释）
  assert.doesNotMatch(stream, /defaultRehypePlugins\.sanitize/);
  // harden 也必须排除：它把 file: 写死进 blockedProtocols（不可覆盖），
  // 会杀死「文件路径可点击打开」核心能力（危险协议由 urlTransform 拦截）
  assert.doesNotMatch(stream, /defaultRehypePlugins\.harden/);
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
  // 灰度开关全链路移除：atom / App 同步 / 设置字段
  assert.doesNotMatch(atoms, /useStreamdownRendererAtom = atom/);
  assert.doesNotMatch(app, /setStreamdownRenderer/);
  assert.doesNotMatch(settingsType, /useStreamdownRenderer/);
  // 依赖已从 package.json 移除
  assert.doesNotMatch(packageJson, /"react-markdown"/);
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
