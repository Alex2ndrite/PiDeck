import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { sessionRecordByIdAtomFamily } from "../../atoms";
import { useSessionTimelineController } from "../../hooks/useSessionTimelineController";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import {
  SessionRuntimeInjector,
  type SessionRuntimeInjectorProps,
} from "./SessionRuntimeInjector";
import { t } from "../../i18n";

type SharedInjectorProps = Omit<
  SessionRuntimeInjectorProps,
  | "currentSessionId"
  | "sessionTitle"
  | "sessionTimeline"
  | "sessionActionsOpen"
  | "setSessionActionsOpen"
  | "chrome"
  | "focused"
  | "onFocusPane"
  | "activeQueuedPrompts"
  | "visibleQueuedPrompts"
  | "queuedTrackRef"
  | "chatHeaderRef"
  | "sessionComboRef"
  | "composerRef"
  | "composerOffsetHeight"
  | "terminalRowHeight"
>;

export type ChatSessionPaneProps = SharedInjectorProps & {
  sessionId: string;
  focused: boolean;
  onFocusPane: () => void;
  chrome: "full" | "pane";
  queuedPromptsBySession: Record<string, QueuedPrompt[]>;
  /** 聚焦栏把 jumpToMessage 登记给大纲等外设 */
  jumpToMessageRef?: React.MutableRefObject<((messageId: string) => void) | null>;
  /** App 测量布局用的 refs；仅聚焦栏挂载，避免双栏抢同一 ref */
  layoutRefs?: {
    chatHeaderRef: React.RefObject<HTMLDivElement | null>;
    sessionComboRef: React.RefObject<HTMLDivElement | null>;
    composerRef: React.RefObject<HTMLElement | null>;
    composerOffsetHeight: number;
    terminalRowHeight: number;
  };
};

/**
 * 单个会话聊天栏：自持 timeline + runtime 注入。
 * 分屏时挂两个实例；单栏时挂一个（chrome=full）。
 */
export function ChatSessionPane(props: ChatSessionPaneProps) {
  const {
    sessionId,
    focused,
    onFocusPane,
    chrome,
    queuedPromptsBySession,
    jumpToMessageRef,
    layoutRefs,
    sessionTabs,
    ...rest
  } = props;

  const record = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const sessionTitle = record?.title?.trim() || t("app.chatProject");

  const sessionTimeline = useSessionTimelineController({ sessionId });
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);

  const localHeaderRef = useRef<HTMLDivElement | null>(null);
  const localComboRef = useRef<HTMLDivElement | null>(null);
  const localComposerRef = useRef<HTMLElement | null>(null);
  const localQueuedTrackRef = useRef<HTMLDivElement | null>(null);

  const chatHeaderRef = focused && layoutRefs ? layoutRefs.chatHeaderRef : localHeaderRef;
  const sessionComboRef = focused && layoutRefs ? layoutRefs.sessionComboRef : localComboRef;
  const composerRef = focused && layoutRefs ? layoutRefs.composerRef : localComposerRef;

  const activeQueuedPrompts = queuedPromptsBySession[sessionId] ?? [];

  useEffect(() => {
    if (!focused || !jumpToMessageRef) return;
    jumpToMessageRef.current = sessionTimeline.jumpToMessage;
    return () => {
      if (jumpToMessageRef.current === sessionTimeline.jumpToMessage) {
        jumpToMessageRef.current = null;
      }
    };
  }, [focused, jumpToMessageRef, sessionTimeline.jumpToMessage]);

  // 点击 Header 下拉外部时收起（原 App 级逻辑下沉到本栏）
  useEffect(() => {
    if (!sessionActionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sessionComboRef.current?.contains(event.target as Node)) return;
      setSessionActionsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [sessionActionsOpen, sessionComboRef]);

  const layout = useMemo(
    () => ({
      chatHeaderRef,
      sessionComboRef,
      composerRef,
      composerOffsetHeight: focused && layoutRefs ? layoutRefs.composerOffsetHeight : 0,
      terminalRowHeight: layoutRefs?.terminalRowHeight ?? 160,
    }),
    [chatHeaderRef, composerRef, focused, layoutRefs, sessionComboRef],
  );

  return (
    <SessionRuntimeInjector
      currentSessionId={sessionId}
      sessionTitle={sessionTitle}
      sessionTabs={sessionTabs}
      sessionTimeline={sessionTimeline}
      chrome={chrome}
      focused={focused}
      onFocusPane={onFocusPane}
      sessionActionsOpen={sessionActionsOpen}
      setSessionActionsOpen={setSessionActionsOpen}
      chatHeaderRef={layout.chatHeaderRef}
      sessionComboRef={layout.sessionComboRef}
      composerRef={layout.composerRef}
      composerOffsetHeight={layout.composerOffsetHeight}
      terminalRowHeight={layout.terminalRowHeight}
      activeQueuedPrompts={activeQueuedPrompts}
      visibleQueuedPrompts={activeQueuedPrompts}
      queuedTrackRef={localQueuedTrackRef}
      {...rest}
    />
  );
}
