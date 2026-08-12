import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 生图（ImageGen 模式）契约测试：IPC 三处同步、主进程装配与凭据解析、
 * composer 生图模式链路、i18n key 对齐。均为源码文本断言（不 vm 执行，
 * 避免 electron/React 运行时依赖）。
 */

const ipc = readFileSync("src/shared/ipc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const mainIndex = readFileSync("src/main/index.ts", "utf8");
const imagegenIpc = readFileSync("src/main/ipc/imagegenIpc.ts", "utf8");
const agentTypes = readFileSync("src/shared/types/agent.ts", "utf8");
const composerComponents = readFileSync("src/renderer/src/components/session/ComposerComponents.tsx", "utf8");
const controller = readFileSync("src/renderer/src/hooks/useSessionComposerController.ts", "utf8");
const composerPanels = readFileSync("src/renderer/src/components/session/ComposerPanels.tsx", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("IPC 通道三处同步：通道常量 ↔ 主进程 handler ↔ preload", () => {
	assert.match(ipc, /imagegenGenerate: "imagegen:generate"/);
	assert.match(imagegenIpc, /ipcChannels\.imagegenGenerate/);
	assert.match(preload, /ipcChannels\.imagegenGenerate/);
	// preload 入参改为 ImageGenRequest
	assert.match(preload, /generate: \(request: ImageGenRequest\)/);
});

test("主进程装配：index.ts 传 configManager + resolveProviderCredentials", () => {
	assert.match(mainIndex, /resolveProviderCredentials\(configManager, provider\)/);
	assert.match(mainIndex, /registerImageGenIpc\(\{/);
	assert.match(mainIndex, /configManager,/);
});

test("IPC 入参校验：provider/model/prompt 非空字符串，prompt ≤ 4000", () => {
	assert.match(imagegenIpc, /typeof candidate\?\.provider === "string"/);
	assert.match(imagegenIpc, /typeof candidate\?\.model === "string"/);
	assert.match(imagegenIpc, /typeof candidate\?\.prompt === "string"/);
	assert.match(imagegenIpc, /prompt\.length > 4000/);
});

test("resolveProviderCredentials：从 models.json/auth.json 拼 baseUrl/apiKey，缺一返 null", () => {
	assert.match(imagegenIpc, /getModelsConfig\(\)/);
	assert.match(imagegenIpc, /getAuthConfig\(\)/);
	assert.match(imagegenIpc, /providerConfig\?\.baseUrl \?\? providerConfig\?\.api/);
	assert.match(imagegenIpc, /providerConfig\?\.apiKey \?\? authKey/);
	assert.match(imagegenIpc, /if \(!baseUrl \|\| !apiKey\) return null;/);
});

test("ComposerAgentMode 含 imagegen 三种模式", () => {
	assert.match(agentTypes, /ComposerAgentMode = "normal" \| "plan" \| "imagegen"/);
});

test("composer 模式选择器与底栏三态（含生图图标）", () => {
	// 模式选择器加生图项
	assert.match(composerComponents, /value: "imagegen" as const/);
	assert.match(composerComponents, /"app\.composerModeImagegen"/);
	// 底栏三态 label + 图标
	assert.match(composerComponents, /const isImageGenMode = props\.composerAgentMode === "imagegen"/);
	assert.match(composerComponents, /isImageGenMode \? \(\s*<ImageIcon size=\{15\}/);
	// 旧的独立生图按钮已移除
	assert.doesNotMatch(composerComponents, /onGenerateImage/);
});

test("controller：生图分支不 send、结果进附件栏、错误码映射", () => {
	// delivery.send 生图分支
	assert.match(controller, /if \(mode === "imagegen"\) \{\s*void generateImage\(\);\s*return;\s*\}/);
	// generateImage 复用 record.model + desktopApi.imagegen.generate + images.add
	assert.match(controller, /desktopApi\.imagegen\.generate\(\{/);
	assert.match(controller, /provider: model\.provider/);
	assert.match(controller, /model: model\.modelId/);
	assert.match(controller, /setAttachments\(\(current\) => \[\.\.\.current, result\.image\]\)/);
	// mapImageGenError 映射错误码到 i18n
	assert.match(controller, /function mapImageGenError\(error: string, detail\?: string\)/);
	assert.match(controller, /case "notConfigured"/);
	assert.match(controller, /case "invalidKey"/);
	assert.match(controller, /case "badBaseUrl"/);
	assert.match(controller, /case "http"/);
});

test("发送控件：生图进行中显示转圈并禁用", () => {
	assert.match(composerPanels, /isGeneratingImage\?: boolean/);
	assert.match(composerPanels, /isGeneratingImage \?\s*\(\s*<LoaderCircle/);
	assert.match(composerPanels, /disabled=\{props\.isAgentStarting \|\| props\.isGeneratingImage \|\| !props\.canSend\}/);
});

test("i18n：zh/en 生图模式与错误文案 key 一致", () => {
	const extract = (src) => [...src.matchAll(/"(app\.composerModeImagegen|app\.composerModeImagegenDesc|imagegen\.[^"]+)"/g)]
		.map((m) => m[0].slice(1, -1)).sort();
	const zhKeys = extract(zh);
	const enKeys = extract(en);
	assert.ok(zhKeys.length >= 8, `zh imagegen keys: ${zhKeys.length}`);
	assert.deepEqual(zhKeys, enKeys);
	// 已删除设置页/弹窗专属文案
	assert.doesNotMatch(zh, /settings\.tabs\.imagegen/);
	assert.doesNotMatch(en, /imagegen\.button/);
});
