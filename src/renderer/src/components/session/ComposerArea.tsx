import { forwardRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  ComposerBottomBar,
  ImagePreviewModal,
  PromptSuggestions,
} from "./ComposerParts";
import {
  RichInput,
} from "../app/RichInput";
import { SessionReferenceModal } from "../app/SessionReferenceModal";
import { t } from "../../i18n";
import { useSessionComposerController } from "../../hooks/useSessionComposerController";
import {
  ComposerAttachmentBar,
  ComposerSendControls,
  SessionDeliveryNotice,
} from "./ComposerPanels";
import { ComposerPickerHost } from "./ComposerPickerHost";
import { ComposerRuntimeIntegrations } from "./ComposerRuntimeIntegrations";
import { desktopApi } from "../../desktopApi";
import type { EnqueuePromptSnapshot } from "../../hooks/useSessionSend";
import type { GitBranchInfo } from "../../../../shared/types";

const COMPOSER_MIN_HEIGHT = 175;

export type ComposerAreaProps = {
  sessionId: string;
  gitInfo?: GitBranchInfo;
  queuePanel?: ReactNode;
  runtimeUi?: ReactNode;
  onOpenFile?: (path: string) => void;
  onHeightChange?: (height: number) => void;
  enqueue?: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
  ensureSessionId?: (sessionId: string) => Promise<string>;
};

export const ComposerArea = forwardRef<HTMLElement, ComposerAreaProps>(function ComposerArea(
  props,
  footerRef,
) {
  const composer = useSessionComposerController({
    sessionId: props.sessionId,
    onOpenFile: props.onOpenFile,
    enqueue: props.enqueue,
    ensureSessionId: props.ensureSessionId,
  });
  const [height, setHeight] = useState(COMPOSER_MIN_HEIGHT);
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const startY = event.clientY;
    const startHeight = height;
    let frame = 0;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maxHeight = Math.max(
          COMPOSER_MIN_HEIGHT,
          Math.min(620, window.innerHeight - 260),
        );
        const next = Math.min(
          maxHeight,
          Math.max(COMPOSER_MIN_HEIGHT, startHeight + startY - moveEvent.clientY),
        );
        setHeight(next);
        props.onHeightChange?.(next);
      });
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-composer-resizing");
    };
    document.body.classList.add("is-composer-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <ComposerRuntimeIntegrations sessionId={props.sessionId}>
      {({ widgets, feishuIndicator }) => (
        <>
          <footer ref={footerRef} className="composer" data-session-id={props.sessionId}>
            <ComposerAttachmentBar
              images={composer.attachments}
              onPreview={composer.images.preview}
              onRemove={composer.images.remove}
              onClear={composer.images.clear}
            />
            {widgets}
            {props.queuePanel}
            <SessionDeliveryNotice
              status={composer.sendState.status}
              message={composer.sendState.unknownSnapshot?.message}
              images={composer.sendState.unknownSnapshot?.images}
              error={composer.sendState.error}
              onAcknowledge={composer.delivery.acknowledgeUnknown}
            />
            {props.runtimeUi}
            <div
              className={`composer-box ${
                composer.bangMode === "bang-bang"
                  ? "shell-silent-mode"
                  : composer.bangMode === "bang"
                    ? "shell-mode"
                    : composer.mode === "plan"
                      ? "plan-mode"
                      : ""
              }`}
              style={{ height }}
            >
              <div
                className="composer-resize-handle"
                title={t("app.resizeComposer")}
                onPointerDown={startResize}
              />
              <RichInput
                ref={composer.editor.ref}
                value={composer.draft}
                className={
                  composer.bangMode === "bang-bang"
                    ? "bang-bang"
                    : composer.bangMode === "bang"
                      ? "bang"
                      : ""
                }
                disabled={composer.isStarting}
                validCommandNames={composer.editor.validCommandNames}
                validFilePaths={composer.editor.validFilePaths}
                validSessionRefs={composer.editor.validSessionRefs}
                caretRef={composer.editor.caretRef}
                placeholder={
                  composer.isStarting
                    ? t("app.agentStartingPlaceholder")
                    : composer.bangMode === "bang-bang"
                      ? t("app.composerSilentPlaceholder")
                      : composer.bangMode === "bang"
                        ? t("app.composerShellPlaceholder")
                        : composer.mode === "plan"
                          ? t("app.composerPlanPlaceholder")
                          : t("app.composerEnterPlaceholder")
                }
                onFocus={composer.editor.onFocus}
                onChange={composer.editor.onChange}
                onCursorChange={composer.editor.onCursorChange}
                onKeyDown={composer.editor.onKeyDown}
                onPaste={composer.editor.onPaste}
                onDrop={composer.editor.onDrop}
                onDragOver={composer.editor.onDragOver}
                onBlur={composer.editor.onBlur}
                onChipClick={composer.editor.onChipClick}
              />
              {composer.suggestions.open && !composer.isStarting ? (
                <PromptSuggestions
                  prompt={composer.draft}
                  items={composer.suggestions.items}
                  selectedIndex={composer.suggestions.selectedIndex}
                  anchorStyle={composer.suggestions.anchorStyle}
                  onSelectedIndexChange={composer.suggestions.setSelectedIndex}
                  onClose={composer.suggestions.close}
                  onPick={composer.suggestions.pick}
                />
              ) : null}
              <ComposerBottomBar
                state={composer.runtime?.state}
                compacting={Boolean(composer.runtime?.state?.isCompacting)}
                disabled={composer.isBusy || composer.isStarting}
                composerAgentMode={composer.mode}
                gitInfo={props.gitInfo}
                record={composer.record}
                feishuIndicator={feishuIndicator}
                onPickModel={() => composer.pickers.open("model")}
                onPickThinking={() => composer.pickers.open("thinking")}
                onPickPromptTemplate={() => composer.pickers.open("template")}
                onCompact={composer.delivery.compact}
                onOpenComposerModePicker={() => composer.pickers.open("mode")}
                onCancelPlan={() => composer.pickers.setMode("normal")}
                onAttachFile={composer.editor.attachFile}
                sendControls={
                  <ComposerSendControls
                    isAgentBusy={composer.isBusy}
                    isAgentStarting={composer.isStarting}
                    keepBusyDraftControls={composer.busyDraftLocked}
                    showBusySendControls={composer.isBusy || composer.busyDraftLocked}
                    hasComposerContent={composer.hasContent}
                    canSend={composer.delivery.canSend}
                    sendBehaviorMenuOpen={composer.delivery.sendBehaviorMenuOpen}
                    onSend={composer.delivery.send}
                    onSendFollowUp={composer.delivery.followUp}
                    onStop={composer.delivery.abort}
                    onToggleBehaviorMenu={composer.delivery.toggleSendBehaviorMenu}
                    onKeepBehaviorMenuOpen={composer.delivery.keepSendBehaviorMenuOpen}
                    onScheduleBehaviorMenuClose={composer.delivery.scheduleSendBehaviorMenuClose}
                  />
                }
              />
            </div>
          </footer>
          <ComposerPickerHost
            sessionId={props.sessionId}
            picker={composer.picker}
            templates={composer.templates}
            onClose={composer.pickers.close}
            onInsertTemplate={composer.pickers.insertTemplate}
          />
          {composer.previewImage ? (
            <ImagePreviewModal
              image={composer.previewImage}
              onClose={composer.modals.closePreview}
            />
          ) : null}
          {composer.sessionReference ? (
            <SessionReferenceModal
              session={composer.sessionReference}
              initialSelected={composer.sessionReferenceSelection
                ? new Set(composer.sessionReferenceSelection.selectedIndices)
                : undefined}
              onClose={composer.modals.closeSessionReference}
              onConfirm={(result, selectedIndices) => {
                composer.modals.confirmSessionReference(
                  result.sessionName,
                  result.messages,
                  selectedIndices,
                );
              }}
              loadMessages={(sessionId) => desktopApi.sessions.readReferenceMessages(sessionId)}
            />
          ) : null}
        </>
      )}
    </ComposerRuntimeIntegrations>
  );
});
