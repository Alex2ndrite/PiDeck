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
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ExtensionWidgetCard } from "./ComposerParts";

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
          <IconButton
            className="image-remove-btn"
            label={t("app.imageRemove")}
            onClick={() => props.onRemove(index)}
          >
            <X size={12} strokeWidth={2.4} aria-hidden="true" />
          </IconButton>
        </div>
      ))}
      <Button
        variant="secondary"
        buttonSize="sm"
        className="image-clear-btn"
        onClick={props.onClear}
      >
        {t("app.clearImages")}
      </Button>
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
  sessionId?: string;
  prompts: QueuedPromptSnapshot[];
  visiblePrompts: QueuedPromptSnapshot[];
  onRetract: (sessionId: string, prompt: QueuedPromptSnapshot) => void;
  onDiscard: (sessionId: string, promptId: string) => void;
}) {
  if (!props.sessionId || !props.prompts.length) return null;
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
                  <IconButton
                    className="queued-icon-btn"
                    label={t("app.retractToInput")}
                    disabled={!canRetractQueuedPromptToInput(status)}
                    onClick={() => props.onRetract(props.sessionId!, prompt)}
                  >
                    <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    className="queued-icon-btn danger"
                    label={t("app.retractDiscard")}
                    disabled={!canDiscardQueuedPrompt(status)}
                    onClick={() => props.onDiscard(props.sessionId!, prompt.id)}
                  >
                    <X size={13} strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SessionDeliveryNotice(props: {
  status: "unknown" | "idle" | "activating" | "sending" | "error";
  message?: string;
  images?: ImageContent[];
  error?: string;
  onAcknowledge: () => void;
}) {
  if (props.status !== "unknown") return null;
  const preview = props.message?.trim() || (props.images?.length ? t("app.queuedImageMessage") : "");
  return (
    <div className="session-delivery-notice" role="status">
      <div className="session-delivery-notice-copy">
        <strong>{t("app.queuedUnknownShort")}</strong>
        {preview ? <span title={preview}>{preview}</span> : null}
        <small>{t("app.queuedUnknown")}</small>
        {props.error ? <small>{props.error}</small> : null}
      </div>
      <Button variant="secondary" buttonSize="sm" onClick={props.onAcknowledge}>
        {t("common.confirm")}
      </Button>
    </div>
  );
}

export function ComposerSendControls(props: {
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
    <div
      className="composer-send-controls flex items-center"
      onMouseLeave={props.onScheduleBehaviorMenuClose}
    >
      <div className="send-behavior-menu-wrap relative flex items-center gap-1.5">
        {props.showBusySendControls && props.hasComposerContent && (
          <div className="send-behavior-toggle inline-flex h-7 overflow-hidden rounded-md bg-primary text-primary-foreground">
            <IconButton
              className="send-behavior-primary size-7 rounded-none text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              label={t("app.sendSteerTitle")}
              onClick={props.onSend}
            >
              <ArrowUp size={15} strokeWidth={2.4} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="send-behavior-chevron size-5 rounded-none border-l border-primary-foreground/20 text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              label={t("app.sendBehaviorTitle")}
              aria-haspopup="menu"
              aria-expanded={props.sendBehaviorMenuOpen}
              onMouseEnter={props.onKeepBehaviorMenuOpen}
              onFocus={props.onKeepBehaviorMenuOpen}
              onClick={props.onToggleBehaviorMenu}
            >
              <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {props.isAgentBusy ? (
          <IconButton
            className="composer-bar-btn stop size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            label={t("app.stop")}
            onClick={props.onStop}
          >
            <Square size={15} strokeWidth={0} fill="currentColor" aria-hidden="true" />
          </IconButton>
        ) : !props.keepBusyDraftControls ? (
          <IconButton
            className="composer-bar-btn send size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground disabled:opacity-40"
            label={t("app.send")}
            disabled={props.isAgentStarting || !props.canSend}
            onClick={props.onSend}
          >
            <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
          </IconButton>
        ) : null}
        {props.sendBehaviorMenuOpen &&
          props.showBusySendControls &&
          props.hasComposerContent && (
            <div
              className="send-behavior-menu absolute right-0 bottom-[calc(100%+6px)] z-50 flex w-40 flex-col gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              role="menu"
              onMouseEnter={props.onKeepBehaviorMenuOpen}
              onMouseLeave={props.onScheduleBehaviorMenuClose}
            >
              <Button
                variant="ghost"
                buttonSize="sm"
                className="send-behavior-option steer justify-start gap-2 px-2"
                role="menuitem"
                onClick={props.onSend}
              >
                <span className="send-behavior-option-dot size-1.5 rounded-full bg-foreground" aria-hidden="true" />
                <span>{t("app.sendSteerTitle")}</span>
              </Button>
              <Button
                variant="ghost"
                buttonSize="sm"
                className="send-behavior-option follow-up justify-start gap-2 px-2"
                role="menuitem"
                onClick={props.onSendFollowUp}
              >
                <span className="send-behavior-option-dot size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span>{t("app.sendFollowUpTitle")}</span>
              </Button>
            </div>
          )}
      </div>
    </div>
  );
}
