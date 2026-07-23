import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { setI18nLocale, t } from "../src/renderer/src/i18n.ts";
import { mergeAgentRuntimeState } from "../src/renderer/src/utils/agentRuntimeState.ts";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const globalListenersSource = readFileSync(
  "src/renderer/src/hooks/useGlobalAgentListeners.ts",
  "utf8",
);
const composerPanelsSource = readFileSync(
  "src/renderer/src/components/session/ComposerPanels.tsx",
  "utf8",
);
const stylesSource = readFileSync("src/renderer/src/styles.css", "utf8");
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

function componentInvocation(source, componentName) {
  const start = source.indexOf(`<${componentName}`);
  const end = source.indexOf("/>", start);
  assert.notEqual(start, -1, `${componentName} invocation must exist`);
  assert.notEqual(end, -1, `${componentName} invocation must be self-closing`);
  return source.slice(start, end + 2);
}

test("pending prompts render inside the composer before composer-box", () => {
  const composerAreaIndex = appSource.indexOf("<ComposerArea");
  const queuePanelIndex = appSource.indexOf("<QueuedPromptPanel");
  assert.ok(composerAreaIndex >= 0, "ComposerArea should exist");
  assert.ok(queuePanelIndex > composerAreaIndex, "pending prompts should stay inside ComposerArea");
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
  const queuedPromptPanel = componentInvocation(appSource, "QueuedPromptPanel");

  assert.match(queuedPromptPanel, /onRetract=\{retractQueuedPromptForEdit\}/);
  assert.match(composerPanelsSource, /app\.retractToInput/);
  assert.match(composerPanelsSource, /app\.retractDiscard/);
  assert.match(appSource, /onDiscard=\{discardQueuedPrompt\}/);
  assert.match(composerPanelsSource, /canRetractQueuedPromptToInput\(status\)/);
  assert.match(composerPanelsSource, /canDiscardQueuedPrompt\(status\)/);
  assert.match(appSource, /const visibleQueuedPrompts = activeQueuedPrompts/);
  assert.match(composerPanelsSource, /queued-behavior-\$\{prompt\.behavior\}/);
  assert.match(stylesSource, /\.queued-list \{[\s\S]*?max-height: 102px;[\s\S]*?overflow-y: auto;/);
  assert.match(stylesSource, /\.queued-row\.queued-behavior-steer \{/);
  assert.match(stylesSource, /\.queued-row\.queued-behavior-followUp \{/);
  assert.match(appSource, /QUEUED_PROMPT_LIMIT/);
  assert.match(appSource, /app\.queuedFull/);
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
  assert.match(appSource, /const \[busyDraftByAgent, setBusyDraftByAgent\] = useState<Record<string, boolean>>/);
  assert.match(appSource, /const showBusySendControls = isAgentBusy \|\| keepBusyDraftControls/);
  assert.match(composerPanelsSource, /\{props\.showBusySendControls && props\.hasComposerContent && \(/);
  assert.match(composerPanelsSource, /\) : !props\.keepBusyDraftControls \? \(/);
  assert.match(appSource, /if \(!isAgentBusy \|\| current\[activeAgentId\]\) return current;/);
  assert.match(sendControls, /showBusySendControls=\{composer\.isBusy \|\| composer\.busyDraftLocked\}/);
  assert.match(stylesSource, /\.send-behavior-menu-wrap \{[\s\S]*?gap: 8px;/);
  assert.match(stylesSource, /\.composer-footer \.send-behavior-toggle \{[\s\S]*?height: 36px;[\s\S]*?background: var\(--color-accent\);[\s\S]*?border-radius: var\(--radius-pill\)/);
  assert.match(stylesSource, /\.send-behavior-chevron \{[\s\S]*?border-left:/);
  assert.match(composerPanelsSource, /className="send-behavior-primary"[\s\S]*?onClick=\{props\.onSend\}/);
  assert.match(composerPanelsSource, /className="send-behavior-chevron"[\s\S]*?onMouseEnter=\{props\.onKeepBehaviorMenuOpen\}[\s\S]*?onClick=\{props\.onToggleBehaviorMenu\}/);
  assert.match(composerAreaSource, /onSend=\{composer\.delivery\.send\}/);
  assert.match(composerPanelsSource, /className="send-behavior-option steer"/);
  assert.match(composerPanelsSource, /className="send-behavior-option follow-up"/);
  assert.match(appSource, /setTimeout\(\(\) => \{[\s\S]*?setSendBehaviorMenuOpen\(false\)[\s\S]*?\}, 160\)/);
  assert.doesNotMatch(composerPanelsSource, /<span>\{t\("app\.sendSteerDesc"\)\}<\/span>/);
  assert.match(stylesSource, /\.send-behavior-menu \{[\s\S]*?width: 156px;[\s\S]*?padding: 4px;/);
  assert.match(stylesSource, /\.send-behavior-option-dot \{[\s\S]*?width: 7px;[\s\S]*?height: 7px;/);
});

test("composer keeps native typing responsive with a live draft ref and transition", () => {
  assert.match(appSource, /const livePromptByAgentRef = useRef<Record<string, string>>\(\{\}\)/);
  assert.match(appSource, /const \[, startPromptTransition\] = useTransition\(\)/);
  assert.match(appSource, /function setPromptFromNativeInput\(agentId: string, value: string\)/);
  assert.match(appSource, /startPromptTransition\(\(\) => \{\s*setPromptByAgent/s);
  assert.match(appSource, /const livePrompt = targetAgentId[\s\S]*?livePromptByAgentRef\.current\[targetAgentId\] \?\? prompt/);
  assert.match(appSource, /if \(suggestionsOpen \&\& suggestionItems\.length > 0\)/);
  assert.match(appSource, /queuedPrompt\.behavior === "direct" \? undefined : queuedPrompt\.behavior/);
  assert.match(appSource, /const currentDraft =[\s\S]*?livePromptByAgentRef\.current\[agentId\] \?\? promptByAgent\[agentId\]/);
  assert.match(appSource, /setPromptForAgent\(currentSessionId, editorText\.text\)/);
  assert.match(appSource, /livePromptByAgentRef\.current = migrateAgentRecord/);
  assert.match(composerPanelsSource, /props\.sendBehaviorMenuOpen &&\s*props\.showBusySendControls &&\s*props\.hasComposerContent/);
  assert.match(appSource, /clearTimeout\(sendBehaviorMenuCloseTimerRef\.current\)/);
  assert.match(composerPanelsSource, /className="send-behavior-option steer"\s*type="button"/);
  assert.match(composerPanelsSource, /className="send-behavior-option follow-up"\s*type="button"/);
});

test("queue drain is serialized and waits for an ordered global capability event", () => {
  assert.match(appSource, /queueFlushByAgentRef = useRef<Set<string>>/);
  assert.match(globalListenersSource, /agents\.onRuntimeState\(/);
  assert.match(
    appSource,
    /previous\?\.isExecutingTool\s*&&\s*!current\.isExecutingTool[\s\S]*?flushQueuedSteerPrompts\(agentId\)/,
  );
  assert.match(runtimeStateSource, /incoming\.toolStateSequence < current\.toolStateSequence/);
  assert.match(agentManagerSource, /updateActiveToolCalls/);
  assert.match(toolRuntimeStateSource, /calls\.delete\(event\.toolCallId\)/);
  assert.match(toolRuntimeStateSource, /completedBatch: event\.type === "end" && current\.size > 0 && calls\.size === 0/);
  assert.match(appSource, /claimIdleHead\(queuedPromptsRef\.current, agentId\)/);
  assert.match(appSource, /claimNextSteerPrompt\(queuedPromptsRef\.current, agentId\)/);
  assert.match(appSource, /resolveClaimedPrompt/);
  assert.doesNotMatch(appSource, /queuedPrompt\.status === "sending"\s*\? \{ \.\.\.queuedPrompt, status: "pending"/);
  assert.match(queueStateSource, /prompt\.status !== "sending" && prompt\.status !== "unknown"/);
});

test("retract edit restores text, attachments, and composer mode to the owning agent", () => {
  assert.match(appSource, /livePrompt\.displayText/);
  assert.match(appSource, /setAttachedImagesForAgent\(agentId, \(current\) => \[/);
  assert.match(appSource, /setComposerAgentModeForAgent\(agentId, livePrompt\.agentMode\)/);
  assert.match(appSource, /pendingComposerCaretRef\.current = restoredPrompt\.length/);
  assert.match(appSource, /setComposerCursor\(restoredPrompt\.length\)/);
  assert.match(appSource, /editor\.scrollTop = editor\.scrollHeight/);
  assert.match(appSource, /livePrompt\.status === "sending"/);
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
  assert.match(queueStateSource, /outcome\.type === "accepted"/);
  assert.match(queueStateSource, /\{ type: "failed" \| "unknown"; error: string \}/);
  assert.match(appSource, /discardQueuedPrompt/);
  assert.match(appSource, /appendUnknownQueuedPrompt\(targetAgentId, queuedPromptSnapshot\)/);
  assert.match(appSource, /status: "unknown"/);
  assert.match(appSource, /accepted === "unknown"/);
});

test("prompt acceptance is explicit across the main and renderer boundary", () => {
  assert.match(agentManagerSource, /Promise<SendPromptResult>/);
  assert.match(agentManagerSource, /return \{ accepted: false, error: errorMessage \}/);
  assert.match(webServiceSource, /this\.sendJson\(response, \{ result \}\)/);
  assert.doesNotMatch(webServiceSource, /sendError\(response, 409, result\.error\)/);
  assert.match(agentManagerSource, /if \(cancelled\)[\s\S]*?命令已取消[\s\S]*?return \{ accepted: true \}/);
  assert.match(appSource, /if \(!result\.accepted\)[\s\S]*?PromptDeliveryUnknownError[\s\S]*?throw new Error\(result\.error\)/);
});
