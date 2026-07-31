import { atom } from "jotai";
import type { ComposerAgentMode, ImageContent } from "../../../shared/types";
import { currentSessionIdAtom } from "./session-atoms";

export type SessionComposerMode = ComposerAgentMode;

export type SessionSendState = {
  status: "idle" | "activating" | "sending" | "error" | "unknown";
  requestId?: string;
  error?: string;
  /** Snapshot kept visible when the transport result cannot prove delivery. */
  unknownSnapshot?: {
    message: string;
    images?: ImageContent[];
  };
};

export const sessionDraftByIdAtom = atom<Record<string, string>>({});
export const sessionAttachmentsByIdAtom = atom<Record<string, ImageContent[]>>({});
export const sessionComposerModeByIdAtom = atom<Record<string, SessionComposerMode>>({});
export const sessionSendStateByIdAtom = atom<Record<string, SessionSendState>>({});

export const currentSessionDraftAtom = atom(
  (get) => {
    const sessionId = get(currentSessionIdAtom);
    return sessionId ? (get(sessionDraftByIdAtom)[sessionId] ?? "") : "";
  },
  (get, set, value: string | ((current: string) => string)) => {
    const sessionId = get(currentSessionIdAtom);
    if (!sessionId) return;
    set(setSessionDraftAtom, { sessionId, value });
  },
);

export const currentSessionAttachmentsAtom = atom(
  (get) => {
    const sessionId = get(currentSessionIdAtom);
    return sessionId ? (get(sessionAttachmentsByIdAtom)[sessionId] ?? []) : [];
  },
  (get, set, value: ImageContent[] | ((current: ImageContent[]) => ImageContent[])) => {
    const sessionId = get(currentSessionIdAtom);
    if (!sessionId) return;
    set(setSessionAttachmentsAtom, { sessionId, value });
  },
);

export const currentSessionComposerModeAtom = atom(
  (get) => {
    const sessionId = get(currentSessionIdAtom);
    return sessionId
      ? (get(sessionComposerModeByIdAtom)[sessionId] ?? "normal")
      : "normal";
  },
  (get, set, mode: SessionComposerMode) => {
    const sessionId = get(currentSessionIdAtom);
    if (!sessionId) return;
    set(setSessionComposerModeAtom, { sessionId, mode });
  },
);

export const currentSessionSendStateAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId
    ? (get(sessionSendStateByIdAtom)[sessionId] ?? { status: "idle" as const })
    : { status: "idle" as const };
});

export const setSessionDraftAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    value: string | ((current: string) => string);
  }) => {
    const drafts = get(sessionDraftByIdAtom);
    const current = drafts[input.sessionId] ?? "";
    const nextValue = typeof input.value === "function"
      ? input.value(current)
      : input.value;
    const next = { ...drafts };
    if (nextValue) next[input.sessionId] = nextValue;
    else delete next[input.sessionId];
    set(sessionDraftByIdAtom, next);
  },
);

export const setSessionAttachmentsAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    value: ImageContent[] | ((current: ImageContent[]) => ImageContent[]);
  }) => {
    const attachments = get(sessionAttachmentsByIdAtom);
    const current = attachments[input.sessionId] ?? [];
    const nextValue = typeof input.value === "function"
      ? input.value(current)
      : input.value;
    const next = { ...attachments };
    if (nextValue.length) next[input.sessionId] = nextValue;
    else delete next[input.sessionId];
    set(sessionAttachmentsByIdAtom, next);
  },
);

export const setSessionComposerModeAtom = atom(
  null,
  (get, set, input: { sessionId: string; mode: SessionComposerMode }) => {
    const modes = { ...get(sessionComposerModeByIdAtom) };
    if (input.mode === "normal") delete modes[input.sessionId];
    else modes[input.sessionId] = input.mode;
    set(sessionComposerModeByIdAtom, modes);
  },
);

export const setSessionSendStateAtom = atom(
  null,
  (get, set, input: { sessionId: string; state: SessionSendState }) => {
    const states = { ...get(sessionSendStateByIdAtom) };
    if (input.state.status === "idle") delete states[input.sessionId];
    else states[input.sessionId] = input.state;
    set(sessionSendStateByIdAtom, states);
  },
);

export const clearSessionComposerSnapshotAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    draft: string;
    attachments: ImageContent[];
  }) => {
    const currentDraft = get(sessionDraftByIdAtom)[input.sessionId] ?? "";
    if (currentDraft === input.draft) {
      set(setSessionDraftAtom, { sessionId: input.sessionId, value: "" });
    }
    const currentAttachments = get(sessionAttachmentsByIdAtom)[input.sessionId] ?? [];
    if (
      currentAttachments.length === input.attachments.length &&
      currentAttachments.every((attachment, index) => attachment === input.attachments[index])
    ) {
      set(setSessionAttachmentsAtom, { sessionId: input.sessionId, value: [] });
    }
  },
);

/**
 * Promote a renderer-only pre-send Chat surface after its first send creates a
 * Catalog Session. Moving every composer map together prevents a remount from
 * dropping text, attachments, mode, or delivery state during that transition.
 */
export const promoteSessionComposerStateAtom = atom(
  null,
  (get, set, input: { fromSessionId: string; toSessionId: string }) => {
    if (input.fromSessionId === input.toSessionId) return;
    const move = <T>(source: Record<string, T>) => {
      if (!(input.fromSessionId in source)) return source;
      const next = { ...source, [input.toSessionId]: source[input.fromSessionId] };
      delete next[input.fromSessionId];
      return next;
    };
    set(sessionDraftByIdAtom, move(get(sessionDraftByIdAtom)));
    set(sessionAttachmentsByIdAtom, move(get(sessionAttachmentsByIdAtom)));
    set(sessionComposerModeByIdAtom, move(get(sessionComposerModeByIdAtom)));
    set(sessionSendStateByIdAtom, move(get(sessionSendStateByIdAtom)));
  },
);

export const removeSessionComposerStateAtom = atom(null, (get, set, sessionId: string) => {
  const drafts = { ...get(sessionDraftByIdAtom) };
  delete drafts[sessionId];
  set(sessionDraftByIdAtom, drafts);
  const attachments = { ...get(sessionAttachmentsByIdAtom) };
  delete attachments[sessionId];
  set(sessionAttachmentsByIdAtom, attachments);
  const modes = { ...get(sessionComposerModeByIdAtom) };
  delete modes[sessionId];
  set(sessionComposerModeByIdAtom, modes);
  const sendStates = { ...get(sessionSendStateByIdAtom) };
  delete sendStates[sessionId];
  set(sessionSendStateByIdAtom, sendStates);
});
