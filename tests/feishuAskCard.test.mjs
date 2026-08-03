import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadAskCardModule() {
	const i18nSource = readFileSync("src/main/feishu/FeishuI18n.ts", "utf8");
	const { outputText: i18nOutput } = ts.transpileModule(i18nSource, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const i18nSandbox = { exports: {} };
	vm.runInNewContext(i18nOutput, i18nSandbox, { filename: "FeishuI18n.ts" });

	const source = readFileSync("src/main/feishu/AskCard.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = {
		exports: {},
		require: (name) => {
			if (name === "./FeishuI18n") return i18nSandbox.exports;
			throw new Error(`unexpected require: ${name}`);
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "AskCard.ts" });
	return sandbox.exports;
}

function actionValueFromButtons(card) {
	const values = [];
	for (const element of card.elements) {
		if (element.tag !== "action") continue;
		for (const action of element.actions) values.push(action.value);
	}
	return values;
}

// vm 沙箱产出的对象与当前 realm 原型不同，deepStrictEqual 会因原型差异失败，这里只比较字段。
function fields(value) {
	if (!value || typeof value !== "object") return value;
	const out = {};
	for (const key of Object.keys(value)) out[key] = value[key];
	return out;
}

test("confirm card renders confirm/reject buttons carrying confirmed flags", () => {
	const { buildAskCard } = loadAskCardModule();
	const card = buildAskCard({
		request: { requestId: "req-1", method: "confirm", title: "是否允许执行 git push？" },
	});

	assert.equal(card.header.title.content, "❓ 需要你的确认");
	assert.equal(card.header.template, "orange");
	const values = actionValueFromButtons(card);
	const confirmBtn = values.find((v) => v.kind === "confirm" && v.confirmed === true);
	const rejectBtn = values.find((v) => v.kind === "confirm" && v.confirmed === false);
	assert.ok(confirmBtn, "confirm=true button missing");
	assert.ok(rejectBtn, "confirm=false button missing");
	for (const v of values) {
		assert.equal(v.action, "pideck.ask");
		assert.equal(v.requestId, "req-1");
	}
});

test("select card renders option buttons, truncates long text but keeps original value", () => {
	const { buildAskCard } = loadAskCardModule();
	const longOption = "这个选项的文字特别特别特别特别特别长超过十八个字符";
	const card = buildAskCard({
		request: { requestId: "req-2", method: "select", title: "选择模型？", options: ["A", longOption] },
	});

	const values = actionValueFromButtons(card);
	const optionValues = values.filter((v) => v.kind === "option");
	assert.equal(optionValues.length, 2);
	assert.equal(optionValues[1].option, longOption, "button value must keep the full original option");

	// 按钮显示文本被截断，但答案值不受影响
	const buttons = [];
	for (const element of card.elements) {
		if (element.tag === "action") buttons.push(...element.actions);
	}
	const longButton = buttons.find((b) => b.value?.option === longOption);
	assert.ok(longButton.text.content.length <= 18, "button label should be truncated to 18 chars");
	// 取消按钮兜底存在
	assert.ok(values.some((v) => v.kind === "cancel"), "cancel button missing");
});

test("input card shows reply-hint note and a cancel button", () => {
	const { buildAskCard } = loadAskCardModule();
	const card = buildAskCard({
		request: { requestId: "req-3", method: "input", title: "请描述你的需求" },
	});

	const notes = card.elements.filter((e) => e.tag === "note");
	assert.ok(notes.some((n) => n.elements[0].content.includes("直接回复本条消息即可回答")));
	assert.ok(actionValueFromButtons(card).some((v) => v.kind === "cancel"));
});

test("batch card renders numbered questions and cancel-only actions", () => {
	const { buildAskCard, tryParseBatchAskEnvelope } = loadAskCardModule();
	const envelope = tryParseBatchAskEnvelope(JSON.stringify({
		__piDeckBatchAsk: 1,
		questions: [
			{ id: "q1", question: "第一个问题？", type: "select", options: ["是", "否"] },
			{ id: "q2", question: "第二个问题？", type: "input" },
		],
	}));
	assert.ok(envelope, "envelope should decode");
	assert.equal(envelope.questions.length, 2);

	const card = buildAskCard({
		request: { requestId: "req-4", method: "batch_ask", title: "", batchQuestions: envelope.questions },
	});
	const markdown = card.elements.find((e) => e.tag === "markdown").content;
	assert.ok(markdown.includes("1. 第一个问题？"));
	assert.ok(markdown.includes("2. 第二个问题？"));
	const values = actionValueFromButtons(card);
	assert.equal(values.filter((v) => v.kind === "option").length, 0, "batch card must not offer option buttons");
	assert.ok(values.some((v) => v.kind === "cancel"));
});

test("parseAskActionValue accepts option/confirm/cancel and rejects garbage", () => {
	const { parseAskActionValue } = loadAskCardModule();

	assert.deepEqual(
		fields(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "option", option: "A" })),
		{ requestId: "r1", kind: "option", option: "A" },
	);
	assert.deepEqual(
		fields(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "confirm", confirmed: true })),
		{ requestId: "r1", kind: "confirm", confirmed: true },
	);
	// confirmed 缺省按 true 处理（确认按钮语义）
	assert.deepEqual(
		fields(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "confirm" })),
		{ requestId: "r1", kind: "confirm", confirmed: true },
	);
	assert.deepEqual(
		fields(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "cancel" })),
		{ requestId: "r1", kind: "cancel" },
	);
	// 非法输入一律 undefined
	assert.equal(parseAskActionValue(null), undefined);
	assert.equal(parseAskActionValue({}), undefined);
	assert.equal(parseAskActionValue({ action: "pideck.set_model", requestId: "r1", kind: "cancel" }), undefined);
	assert.equal(parseAskActionValue({ action: "pideck.ask", requestId: "", kind: "cancel" }), undefined);
	assert.equal(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "option", option: "" }), undefined);
	assert.equal(parseAskActionValue({ action: "pideck.ask", requestId: "r1", kind: "hack" }), undefined);
});

test("tryParseBatchAskEnvelope rejects non-envelope and malformed payloads", () => {
	const { tryParseBatchAskEnvelope } = loadAskCardModule();

	assert.equal(tryParseBatchAskEnvelope("普通问题文本"), undefined);
	assert.equal(tryParseBatchAskEnvelope("{not json"), undefined);
	assert.equal(tryParseBatchAskEnvelope(JSON.stringify({ questions: [] })), undefined, "missing marker");
	assert.equal(
		tryParseBatchAskEnvelope(JSON.stringify({ __piDeckBatchAsk: 1, questions: [{ id: "q", question: "x", type: "weird" }] })),
		undefined,
		"invalid question type should be filtered out",
	);
});
