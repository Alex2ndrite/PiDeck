import {
  ArrowUp,
  ChevronDown,
  Pencil,
  Square,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import type { ImageContent } from "../../../../shared/types";
import type { QueuedPromptSnapshot } from "../../utils/queuedPromptQueue";
import {
  canDiscardQueuedPrompt,
  canRetractQueuedPromptToInput,
} from "../../utils/queuedPromptQueue";
import { t } from "../../i18n";
import { ExtensionWidgetCard } from "../app/AppParts";

export function ComposerAttachmentBar(props: {
  images: ImageContent[];
  onPreview: (image: ImageContent) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  if (!props.images.length) return null;
  return (
    <div className="image-preview-area">
      {props.images.map((image, index) => (
        <div key={index} className="image-preview-item">
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={t("app.imageAlt", { index: index + 1 })}
            onClick={() => props.onPreview(image)}
            style={{ cursor: "pointer" }}
          />
          <button
            type="button"
            className="image-remove-btn"
            onClick={() => props.onRemove(index)}
            title={t("app.imageRemove")}
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="image-clear-btn"
        onClick={props.onClear}
        title={t("app.clearImagesTitle")}
      >
        {t("app.clearImages")}
      </button>
    </div>
  );
}

export function ExtensionWidgetPanel(props: {
  widgets?: Record<string, string[]>;
  sessionId?: string;
  /** @deprecated A8 compatibility for the pre-leaf App call site. */
  sessionKey?: string;
  dismissedKeys: string[];
  collapsed: boolean;
  onDismiss: (widgetKey: string) => void;
}) {
  const sessionId = props.sessionId ?? props.sessionKey;
  if (!sessionId || !props.widgets || !Object.keys(props.widgets).length) return null;
  return (
    <div className="extension-widgets-container">
      {!props.collapsed &&
        Object.entries(props.widgets)
          .filter(([widgetKey]) => !props.dismissedKeys.includes(widgetKey))
          .map(([widgetKey, lines]) => (
            <ExtensionWidgetCard
              key={widgetKey}
              widgetKey={widgetKey}
              lines={lines}
              sessionIdOrPath={sessionId}
              onClose={() => props.onDismiss(widgetKey)}
            />
          ))}
    </div>
  );
}

export function QueuedPromptPanel(props: {
  trackRef: RefObject<HTMLDivElement | null>;
  agentId?: string;
  prompts: QueuedPromptSnapshot[];
  visiblePrompts: QueuedPromptSnapshot[];
  onRetract: (agentId: string, prompt: QueuedPromptSnapshot) => void;
  onDiscard: (agentId: string, promptId: string) => void;
}) {
  if (!props.agentId || !props.prompts.length) return null;
  return (
    <div
      ref={props.trackRef}
      className="queued-track"
      aria-label={t("app.queuedMessagesLabel")}
    >
      <div className="queued-panel">
        <div className="queued-panel-header">
          <span>{t("app.queuedMessagesLabel")}</span>
          <span className="queued-panel-count">{props.prompts.length}</span>
        </div>
        <div className="queued-list">
          {props.visiblePrompts.map((prompt, index) => {
            const status = prompt.status ?? "pending";
            const previewText =
              prompt.displayText.trim() || t("app.queuedImageMessage");
            const rowTitle = [
              previewText,
              prompt.error,
              status === "unknown" ? t("app.queuedUnknown") : "",
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <div
                key={prompt.id}
                className={`queued-row ${status} queued-behavior-${prompt.behavior}`}
                title={rowTitle}
              >
                <span className="queued-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="queued-text">{previewText}</span>
                {prompt.images?.length ? (
                  <span className="queued-meta">
                    {t("app.queuedImageCount", {
                      count: String(prompt.images.length),
                    })}
                  </span>
                ) : null}
                {status === "sending" ? (
                  <span className="queued-meta">{t("app.queuedSending")}</span>
                ) : status === "failed" ? (
                  <span className="queued-meta failed">{t("app.queuedFailed")}</span>
                ) : status === "unknown" ? (
                  <span className="queued-meta unknown">
                    {t("app.queuedUnknownShort")}
                  </span>
                ) : null}
                <div className="queued-actions">
                  <button
                    type="button"
                    className="queued-icon-btn"
                    disabled={!canRetractQueuedPromptToInput(status)}
                    title={t("app.retractToInput")}
                    aria-label={t("app.retractToInput")}
                    onClick={() => props.onRetract(props.agentId!, prompt)}
                  >
                    <Pencil size={13} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className="queued-icon-btn danger"
                    disabled={!canDiscardQueuedPrompt(status)}
                    title={t("app.retractDiscard")}
                    aria-label={t("app.retractDiscard")}
                    onClick={() => props.onDiscard(props.agentId!, prompt.id)}
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ComposerSendControls(props: {
  composerMode?: string | null;
  statusText: string;
  isAgentBusy: boolean;
  isAgentStarting: boolean;
  keepBusyDraftControls: boolean;
  showBusySendControls: boolean;
  hasComposerContent: boolean;
  canSend: boolean;
  sendBehaviorMenuOpen: boolean;
  onSend: () => void;
  onSendFollowUp: () => void;
  onStop: () => void;
  onToggleBehaviorMenu: () => void;
  onKeepBehaviorMenuOpen: () => void;
  onScheduleBehaviorMenuClose: () => void;
}) {
  return (
    <div className="composer-footer">
      {props.composerMode && (
        <span className="composer-mode-status">{props.statusText}</span>
      )}
      <div className="footer-actions">
        <div
          className="send-behavior-menu-wrap"
          onMouseLeave={props.onScheduleBehaviorMenuClose}
        >
          {props.showBusySendControls && props.hasComposerContent && (
            <div className="send-behavior-toggle">
              <button
                type="button"
                className="send-behavior-primary"
                title={t("app.sendSteerTitle")}
                aria-label={t("app.sendSteerTitle")}
                onClick={props.onSend}
              >
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="send-behavior-chevron"
                title={t("app.sendBehaviorTitle")}
                aria-label={t("app.sendBehaviorTitle")}
                aria-haspopup="menu"
                aria-expanded={props.sendBehaviorMenuOpen}
                onMouseEnter={props.onKeepBehaviorMenuOpen}
                onFocus={props.onKeepBehaviorMenuOpen}
                onClick={props.onToggleBehaviorMenu}
              >
                <ChevronDown size={12} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {props.isAgentBusy ? (
            <button
              type="button"
              className="btn-circle stop"
              onClick={props.onStop}
              title={t("app.stop")}
              aria-label={t("app.stop")}
            >
              <Square size={18} strokeWidth={0} fill="currentColor" />
            </button>
          ) : !props.keepBusyDraftControls ? (
            <button
              type="button"
              disabled={props.isAgentStarting || !props.canSend}
              className="btn-circle send"
              onClick={props.onSend}
              title={t("app.send")}
              aria-label={t("app.send")}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          ) : null}
          {props.sendBehaviorMenuOpen &&
            props.showBusySendControls &&
            props.hasComposerContent && (
              <div
                className="send-behavior-menu"
                role="menu"
                onMouseEnter={props.onKeepBehaviorMenuOpen}
                onMouseLeave={props.onScheduleBehaviorMenuClose}
              >
                <button
                  className="send-behavior-option steer"
                  type="button"
                  role="menuitem"
                  onClick={props.onSend}
                >
                  <span className="send-behavior-option-dot" aria-hidden="true" />
                  <span>{t("app.sendSteerTitle")}</span>
                </button>
                <button
                  className="send-behavior-option follow-up"
                  type="button"
                  role="menuitem"
                  onClick={props.onSendFollowUp}
                >
                  <span className="send-behavior-option-dot" aria-hidden="true" />
                  <span>{t("app.sendFollowUpTitle")}</span>
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
