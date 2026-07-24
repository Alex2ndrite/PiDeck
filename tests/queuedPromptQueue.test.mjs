import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { setI18nLocale, t } from "../src/renderer/src/i18n.ts";
import { mergeAgentRuntimeState } from "../src/renderer/src/utils/agentRuntimeState.ts";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const sessionViewSource = readFileSync(
  "src/renderer/src/components/session/SessionView.tsx",
  "utf8",
);
const sessionRuntimeInjectorSource = readFileSync(
  "src/renderer/src/components/session/SessionRuntimeInjector.tsx",
  "utf8",
);
const bootstrapSource = readFileSync(
  "src/renderer/src/components/app/AppBootstrap.tsx",
  "utf8",
);
const globalListenersSource = readFileSync(
  "src/renderer/src/hooks/useGlobalAgentListeners.ts",
  "utf8",
);
const composerPanelsSource = readFileSync(
  "src/renderer/src/components/session/ComposerPanels.tsx",
  "utf8",
);
const stylesSource = readFileSync("src/renderer/src/styles.css", "utf8");
const i18nSource = readFileSync("src/renderer/src/i18n.ts", "utf8");
const runtimeStateSource = readFileSync(
  "src/renderer/src/utils/agentRuntimeState.ts",
  "utf8",
);
const queueStateSource = readFileSync(
  "src/renderer/src/utils/queuedPromptQueue.ts",
  "utf8",
);
const toolRuntimeStateSource = readFileSync(
  "src/shared/toolRuntimeState.ts",
  "utf8",
);
const agentManagerSource = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const webServiceSource = readFileSync(
  "src/main/web/WebServiceManager.ts",
  "utf8",
);
const sharedTypesSource = readFileSync("src/shared/types.ts", "utf8");
// Queue ownership now lives in useQueuedPrompt.
const queuedPromptHookSource = readFileSync(
  "src/renderer/src/hooks/useQueuedPrompt.ts",
  "utf8",
);
const composerControllerSource = readFileSync(
  "src/renderer/src/hooks/useSessionComposerController.ts",
  "utf8",
);
const sessionSendSource = readFileSync(
  "src/renderer/src/hooks/useSessionSend.ts",
  "utf8",
);

function componentInvocation(source, componentName) {
  const start = source.indexOf(`<${componentName}`);
  const end = source.indexOf("/>", start);
  assert.notEqual(start, -1, `${componentName} invocation must exist`);
  assert.notEqual(end, -1, `${componentName} invocation must be self-closing`);
  return source.slice(start, end + 2);
}

test("pending prompts render inside the composer before composer-box", () => {
  const composerAreaIndex = sessionViewSource.indexOf("<ComposerArea");
  const queuePanelIndex = sessionRuntimeInjectorSource.indexOf("<QueuedPromptPanel");
  assert.ok(composerAreaIndex >= 0, "ComposerArea should exist");
  assert.ok(
    queuePanelIndex >= 0,
    "QueuedPromptPanel should exist in SessionRuntimeInjector",
  );
  assert.match(composerPanelsSource, /className="queued-track"/);
});

test("pending prompts share the native content width constraint without hiding composer", () => {
  assert.match(
    stylesSource,
    /\.chat-pane\[style\*="--content-max-width"\] \.queued-track\s*\{[\s\S]*?width: min\(100%, var\(--content-max-width\)\)/,
  );
  // Outer track is a full-width anchor; the compact panel sits on the right with proportional width.
  assert.match(stylesSource, /\.queued-track \{[\s\S]*?justify-content: flex-end;/);
  assert.match(stylesSource, /\.queued-panel \{[\s\S]*?width: clamp\(/);
  assert.match(stylesSource, /\.queued-row \{[\s\S]*?min-height: 32px;/);
  assert.match(stylesSource, /\.queued-text \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.doesNotMatch(stylesSource, /\.queued-card \{/);
});

test("compact queue panel exposes retract-to-input and discard only", () => {
  const queuedPromptPanel = componentInvocation(sessionRuntimeInjectorSource, "QueuedPromptPanel");

  assert.match(queuedPromptPanel, /onRetract=\{queueRetract\}/);
  assert.match(composerPanelsSource, /app\.retractToInput/);
  assert.match(composerPanelsSource, /app\.retractDiscard/);
  assert.match(sessionRuntimeInjectorSource, /onDiscard=\{queueDiscard\}/);
  assert.match(composerPanelsSource, /canRetractQueuedPromptToInput\(status\)/);
  assert.match(composerPanelsSource, /canDiscardQueuedPrompt\(status\)/);
  assert.match(appSource, /const visibleQueuedPrompts = activeQueuedPrompts/);
  assert.match(composerPanelsSource, /queued-behavior-\$\{prompt\.behavior\}/);
  assert.match(stylesSource, /\.queued-list \{[\s\S]*?max-height: 102px;[\s\S]*?overflow-y: auto;/);
  assert.match(stylesSource, /\.queued-row\.queued-behavior-steer \{/);
  assert.match(stylesSource, /\.queued-row\.queued-behavior-followUp \{/);
  assert.match(queuedPromptHookSource, /QUEUED_PROMPT_LIMIT/);
  assert.match(i18nSource, /"app\.queuedFull"/);
  assert.doesNotMatch(composerPanelsSource, /app\.queuedRetry/);
  assert.doesNotMatch(composerPanelsSource, /app\.queuedAcknowledge/);
  assert.doesNotMatch(appSource, /retryQueuedPrompt/);
  assert.match(queueStateSource, /export const QUEUED_PROMPT_LIMIT = 10/);
  assert.match(queueStateSource, /export const QUEUED_PROMPT_VISIBLE = 3/);
});

test("busy composer keeps stop and queued-send controls separate", () => {
  const composerAreaSource = readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
  const sendControls = componentInvocation(composerAreaSource, "ComposerSendControls");

  assert.match(sendControls, /onSendFollowUp=\{composer\.delivery\.followUp\}/);
  assert.match(composerPanelsSource, /className="btn-circle stop"/);
  assert.match(composerPanelsSource, /className="send-behavior-toggle"/);
  assert.match(composerPanelsSource, /className="send-behavior-primary"/);
  assert.match(composerPanelsSource, /className="send-behavior-chevron"/);
  assert.match(composerPanelsSource, /\{props\.showBusySendControls && props\.hasComposerContent && \(/);
  assert.match(composerPanelsSource, /\) : !props\.keepBusyDraftControls \? \(/);
  assert.match(sendControls, /showBusySendControls=\{composer\.isBusy \|\| composer\.busyDraftLocked\}/);
  assert.match(stylesSource, /\.send-behavior-menu-wrap \{[\s\S]*?gap: 8px;/);
  assert.match(stylesSource, /\.composer-footer \.send-behavior-toggle \{[\s\S]*?height: 36px;[\s\S]*?background: var\(--color-accent\);[\s\S]*?border-radius: var\(--radius-pill\)/);
  assert.match(stylesSource, /\.send-behavior-chevron \{[\s\S]*?border-left:/);
  assert.match(composerPanelsSource, /className="send-behavior-primary"[\s\S]*?onClick=\{props\.onSend\}/);
  assert.match(composerPanelsSource, /className="send-behavior-chevron"[\s\S]*?onMouseEnter=\{props\.onKeepBehaviorMenuOpen\}[\s\S]*?onClick=\{props\.onToggleBehaviorMenu\}/);
  assert.match(composerAreaSource, /onSend=\{composer\.delivery\.send\}/);
  assert.match(composerPanelsSource, /className="send-behavior-option steer"/);
  assert.match(composerPanelsSource, /className="send-behavior-option follow-up"/);
  assert.doesNotMatch(composerPanelsSource, /<span>\{t\("app\.sendSteerDesc"\)\}<\/span>/);
  assert.match(stylesSource, /\.send-behavior-menu \{[\s\S]*?width: 156px;[\s\S]*?padding: 4px;/);
  assert.match(stylesSource, /\.send-behavior-option-dot \{[\s\S]*?width: 7px;[\s\S]*?height: 7px;/);
});

test("composer keeps native typing inside the Session feature root", () => {
  assert.match(composerControllerSource, /const liveDomDraftRef = useRef\(\{ sessionId, value: draft \}\)/);
  assert.match(composerControllerSource, /liveDomDraftRef\.current = \{ sessionId, value \}/);
  assert.match(composerControllerSource, /setDraft\(value\)/);
  assert.match(composerControllerSource, /canApplyRuntimeEditorText/);
  assert.doesNotMatch(appSource, /currentSessionDraftAtom/);
  assert.doesNotMatch(appSource, /setPromptForAgent\(currentSessionId, editorText\.text\)/);
  assert.match(queuedPromptHookSource, /queuedPrompt\.behavior === "direct" \? undefined : queuedPrompt\.behavior/);
  assert.match(queuedPromptHookSource, /const currentDraft = store\.get\(sessionDraftByIdAtom\)\[sessionId\] \?\? ""/);
  assert.doesNotMatch(queuedPromptHookSource, /promptByAgent/);
  assert.match(appSource, /livePromptByAgentRef\.current = migrateAgentRecord/);
  assert.match(composerPanelsSource, /props\.sendBehaviorMenuOpen &&\s*props\.showBusySendControls &&\s*props\.hasComposerContent/);
  assert.match(composerPanelsSource, /className="send-behavior-option steer"\s*type="button"/);
  assert.match(composerPanelsSource, /className="send-behavior-option follow-up"\s*type="button"/);
});

test("queue drain is serialized and waits for an ordered global capability event", () => {
  assert.match(appSource, /queueFlushByAgentRef = useRef<Set<string>>/);
  assert.match(globalListenersSource, /agents\.onRuntimeState\(/);
  assert.match(
    bootstrapSource,
    /previous\?\.isExecutingTool\s*&&\s*!current\.isExecutingTool[\s\S]*?queueFlushSteer\(agentId\)/,
  );
  assert.match(runtimeStateSource, /incoming\.toolStateSequence < current\.toolStateSequence/);
  assert.match(agentManagerSource, /updateActiveToolCalls/);
  assert.match(toolRuntimeStateSource, /calls\.delete\(event\.toolCallId\)/);
  assert.match(toolRuntimeStateSource, /completedBatch: event\.type === "end" && current\.size > 0 && calls\.size === 0/);
  assert.match(queuedPromptHookSource, /claimIdleHead\(queuedPromptsRef\.current, agentId\)/);
  assert.match(queuedPromptHookSource, /claimNextSteerPrompt\(queuedPromptsRef\.current, agentId\)/);
  assert.match(queuedPromptHookSource, /resolveClaimedPrompt/);
  assert.doesNotMatch(appSource, /queuedPrompt\.status === "sending"\s*\? \{ \.\.\.queuedPrompt, status: "pending"/);
  assert.match(queueStateSource, /prompt\.status !== "sending" && prompt\.status !== "unknown"/);
});

test("retract edit restores text, attachments, and composer mode to the owning agent", () => {
  assert.match(queuedPromptHookSource, /livePrompt\.displayText/);
  assert.match(queuedPromptHookSource, /setAttachedImagesForAgent\(agentId, \(current\) => \[/);
  assert.match(queuedPromptHookSource, /store\.set\(setSessionComposerModeAtom, \{ sessionId, mode: livePrompt\.agentMode \}\)/);
  assert.doesNotMatch(queuedPromptHookSource, /setComposerAgentModeForAgent/);
  assert.match(queuedPromptHookSource, /pendingComposerCaretRef\.current = restoredPrompt\.length/);
  assert.match(queuedPromptHookSource, /setComposerCursor\(restoredPrompt\.length\)/);
  assert.match(queuedPromptHookSource, /editor\.scrollTop = editor\.scrollHeight/);
  assert.match(queuedPromptHookSource, /livePrompt\.status === "sending"/);
});

test("retract edit uses action-oriented copy", () => {
  setI18nLocale("zh-CN");
  assert.equal(t("app.retractToInput"), "撤回修改");
  setI18nLocale("en-US");
  assert.equal(t("app.retractToInput"), "Retract to edit");
});

test("queued image count uses the standard i18n interpolation syntax", () => {
  setI18nLocale("zh-CN");
  assert.equal(t("app.queuedImageCount", { count: 3 }), "3 图");
  setI18nLocale("en-US");
  assert.equal(t("app.queuedImageCount", { count: 3 }), "3 img");
});

test("runtime state merge rejects stale tool edges without losing non-tool fields", () => {
  const current = {
    modelId: "new-model",
    isExecutingTool: false,
    toolStateSequence: 4,
  };
  const merged = mergeAgentRuntimeState(current, {
    modelName: "Updated name",
    isExecutingTool: true,
    executingToolName: "read",
    toolStateSequence: 3,
  });

  assert.equal(merged.modelName, "Updated name");
  assert.equal(merged.modelId, "new-model");
  assert.equal(merged.isExecutingTool, false);
  assert.equal(merged.executingToolName, undefined);
  assert.equal(merged.toolStateSequence, 4);
});

test("indeterminate prompt timeout never becomes a retryable rejection", () => {
  assert.match(
    sharedTypesSource,
    /delivery: "unknown"/,
  );
  assert.match(
    agentManagerSource,
    /catch \(error\)[\s\S]*?delivery: "unknown"/,
  );
  assert.match(
    agentManagerSource,
    /命令接收结果未知[\s\S]*?delivery: "unknown"/,
  );
  assert.match(queuedPromptHookSource, /status: "unknown"/);
  assert.match(sessionSendSource, /outcome === "unknown"/);
  assert.match(sessionSendSource, /status: "unknown"/);
  assert.match(composerPanelsSource, /SessionDeliveryNotice/);
  const runtimeControllerSource = readFileSync(
    "src/renderer/src/hooks/useSessionRuntimeController.ts",
    "utf8",
  );
  assert.match(runtimeControllerSource, /\.status === "unknown"/);
});

test("prompt acceptance is explicit across the main and renderer boundary", () => {
  assert.match(agentManagerSource, /Promise<SendPromptResult>/);
  assert.match(agentManagerSource, /return \{ accepted: false, error: errorMessage \}/);
  assert.match(webServiceSource, /this\.sendJson\(response, \{ result \}\)/);
  assert.doesNotMatch(webServiceSource, /sendError\(response, 409, result\.error\)/);
  assert.match(agentManagerSource, /if \(cancelled\)[\s\S]*?命令已取消[\s\S]*?return \{ accepted: true \}/);
  assert.match(appSource, /if \(!result\.accepted\)[\s\S]*?PromptDeliveryUnknownError[\s\S]*?throw new Error\(result\.error\)/);
});
