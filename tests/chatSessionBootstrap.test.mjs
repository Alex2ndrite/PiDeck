import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { resolveChatSessionBootstrap } = loadTsCommonJs(
  "src/renderer/src/utils/chatSessionBootstrap.ts",
);
const composerAtoms = loadTsCommonJs("src/renderer/src/atoms/composer-atoms.ts");
const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");

function resolve(input) {
  // The TypeScript loader executes modules in a VM realm, so normalize the
  // returned record before comparing it with Node's assertion realm.
  return JSON.parse(JSON.stringify(resolveChatSessionBootstrap(input)));
}

test("Chat bootstrap loads a collapsed catalog, then selects the renderer-only surface", () => {
	assert.deepEqual(resolve({
		isChatProject: true,
		catalogStatus: "idle",
	}), { kind: "load" });
	assert.deepEqual(resolve({
		isChatProject: true,
		catalogStatus: "error",
	}), { kind: "load" });
	assert.deepEqual(resolve({
		isChatProject: true,
    catalogStatus: "loading",
  }), { kind: "wait" });
  assert.deepEqual(resolve({
    isChatProject: true,
    catalogStatus: "ready",
  }), { kind: "select", sessionId: "renderer:chat-bootstrap" });
});

test("Chat bootstrap never replaces an existing selection or non-Chat project", () => {
  assert.deepEqual(resolve({
    isChatProject: true,
    currentSessionId: "selected",
    catalogStatus: "ready",
  }), { kind: "none" });
  assert.deepEqual(resolve({
    isChatProject: false,
    catalogStatus: "ready",
  }), { kind: "none" });
});

test("Chat bootstrap loads its catalog before selecting the virtual surface", () => {
	assert.match(appSource, /action\.kind === "load"[\s\S]*refreshProjectSessions\(activeProject\.id\)/);
	assert.match(appSource, /action\.kind === "select"[\s\S]*selectSessionCommand\(activeProject\.id, action\.sessionId, false\)/);
});

test("promoting the Chat surface moves all composer state without retaining the virtual ID", () => {
  const store = createStore();
  const bootstrapId = "renderer:chat-bootstrap";
  const realId = "catalog-session";
  store.set(composerAtoms.sessionDraftByIdAtom, { [bootstrapId]: "hello" });
  store.set(composerAtoms.sessionAttachmentsByIdAtom, { [bootstrapId]: [{ name: "image.png" }] });
  store.set(composerAtoms.sessionComposerModeByIdAtom, { [bootstrapId]: "plan" });
  store.set(composerAtoms.sessionSendStateByIdAtom, { [bootstrapId]: { status: "activating" } });
  store.set(composerAtoms.promoteSessionComposerStateAtom, {
    fromSessionId: bootstrapId,
    toSessionId: realId,
  });
  const promotedDrafts = store.get(composerAtoms.sessionDraftByIdAtom);
  assert.equal(promotedDrafts[realId], "hello");
  assert.equal(promotedDrafts[bootstrapId], undefined);
  assert.equal(store.get(composerAtoms.sessionAttachmentsByIdAtom)[realId][0].name, "image.png");
  const promotedModes = store.get(composerAtoms.sessionComposerModeByIdAtom);
  assert.equal(promotedModes[realId], "plan");
  assert.equal(promotedModes[bootstrapId], undefined);
  assert.equal(store.get(composerAtoms.sessionSendStateByIdAtom)[realId].status, "activating");
});
