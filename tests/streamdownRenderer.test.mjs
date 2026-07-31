import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// UI 2.0（#115 U2）：Streamdown 灰度管线的结构守护。
// 关键点：默认关闭可回退；两条管线共享同一份链接/路径处理实现。
const stream = readFileSync("src/renderer/src/components/session/MarkdownStream.tsx", "utf8");
const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const link = readFileSync("src/renderer/src/components/session/MarkdownLink.tsx", "utf8");
const settingsType = readFileSync("src/shared/types/settings.ts", "utf8");
const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
const atoms = readFileSync("src/renderer/src/atoms/app-ui-atoms.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");

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

test("link handling is shared between legacy and streamdown pipelines", () => {
  // 单份实现：旧管线从共享模块 import，不允许再出现本地重复定义
  assert.match(surface, /from "\.\/MarkdownLink"/);
  assert.doesNotMatch(surface, /function MarkdownLink\(/);
  assert.doesNotMatch(surface, /const remarkLinkifyPaths = /);
  assert.match(link, /export function MarkdownLink/);
  assert.match(link, /export const remarkLinkifyPaths/);
  assert.match(link, /export function markdownUrlTransform/);
});

test("streamdown flag defaults ON (graduated) and is wired settings → atom → AssistantText", () => {
  assert.match(settingsType, /useStreamdownRenderer\?: boolean/);
  // 转正后默认开启；设置项保留作为回退通道（AGENTS 灰度规则）
  assert.match(store, /useStreamdownRenderer: true/);
  assert.match(app, /setStreamdownRenderer\(Boolean\(settings\.useStreamdownRenderer\)\)/);
  // AssistantText 按开关分流，两条路径共用 cleanText
  assert.match(surface, /useAtomValue\(useStreamdownRendererAtom\)/);
  assert.match(surface, /\{useStreamdown \? \(/);
});
