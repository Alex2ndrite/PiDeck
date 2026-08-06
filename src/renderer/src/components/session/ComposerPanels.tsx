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
import { Button } from "../ui-shadcn/button";
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
          <Button variant="ghost" size="icon"
            className="image-remove-btn"
            aria-label={t("app.imageRemove")} title={t("app.imageRemove")}
            onClick={() => props.onRemove(index)}
          >
            <X size={12} strokeWidth={2.4} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
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
      className="queued-track flex min-w-0 w-full justify-end p-0 pb-2"
      aria-label={t("app.queuedMessagesLabel")}
    >
      <div className="flex min-w-0 w-[clamp(13.5rem,36%,22.5rem)] max-w-full flex-col gap-1 rounded-[9px] border border-[color-mix(in_srgb,var(--color-border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--color-bg-panel)_95%,var(--color-chat-card-bg))] p-[7px] pb-2 shadow-[var(--shadow-border),0_6px_18px_color-mix(in_srgb,#000_5%,transparent)]">
        <div className="flex items-center justify-between gap-2 px-[3px] pb-[3px] font-mono text-micro font-semibold leading-4 tracking-[0.02em] text-text-tertiary">
          <span>{t("app.queuedMessagesLabel")}</span>
          <span className="tabular-nums text-text-secondary">{props.prompts.length}</span>
        </div>
        <div className="flex min-w-0 max-h-[102px] flex-col gap-[3px] overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:var(--color-border-default)_transparent] focus-within:[scrollbar-color:var(--color-border-default)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-border-default)] focus-within:[&::-webkit-scrollbar-thumb]:bg-[var(--color-border-default)]">
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
                className={`queued-row flex min-h-8 shrink-0 basis-8 items-center gap-1.5 rounded-[7px] border border-transparent px-[5px] py-1 pl-2 transition-[border-color,background-color] duration-100 ${status} queued-behavior-${prompt.behavior}`}
                title={rowTitle}
              >
                <span className="w-[1.1em] shrink-0 text-center font-mono text-micro leading-none tabular-nums text-text-tertiary" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-[1_1_auto] truncate text-caption leading-[18px] text-text-primary">{previewText}</span>
                {prompt.images?.length ? (
                  <span className="shrink-0 font-mono text-micro leading-none text-text-tertiary">
                    {t("app.queuedImageCount", {
                      count: String(prompt.images.length),
                    })}
                  </span>
                ) : null}
                {status === "sending" ? (
                  <span className="shrink-0 font-mono text-micro leading-none text-text-tertiary">{t("app.queuedSending")}</span>
                ) : status === "failed" ? (
                  <span className="shrink-0 font-mono text-micro leading-none text-[var(--color-danger)]">{t("app.queuedFailed")}</span>
                ) : status === "unknown" ? (
                  <span className="shrink-0 font-mono text-micro leading-none text-[var(--color-warning)]">
                    {t("app.queuedUnknownShort")}
                  </span>
                ) : null}
                <div className="inline-flex shrink-0 items-center gap-px">
                  <Button variant="ghost" size="icon"
                    className="size-[26px] rounded-[4px] p-0 text-text-tertiary hover:bg-[color:color-mix(in_srgb,var(--color-accent)_10%,transparent)] hover:text-[color:var(--color-accent)]"
                    aria-label={t("app.retractToInput")} title={t("app.retractToInput")}
                    disabled={!canRetractQueuedPromptToInput(status)}
                    onClick={() => props.onRetract(props.sessionId!, prompt)}
                  >
                    <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon"
                    className="size-[26px] rounded-[4px] p-0 text-text-tertiary hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                    aria-label={t("app.retractDiscard")} title={t("app.retractDiscard")}
                    disabled={!canDiscardQueuedPrompt(status)}
                    onClick={() => props.onDiscard(props.sessionId!, prompt.id)}
                  >
                    <X size={13} strokeWidth={2} aria-hidden="true" />
                  </Button>
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
      <Button variant="secondary" size="sm" onClick={props.onAcknowledge}>
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
            <Button variant="ghost" size="icon"
              className="send-behavior-primary size-7 rounded-none text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              aria-label={t("app.sendSteerTitle")} title={t("app.sendSteerTitle")}
              onClick={props.onSend}
            >
              <ArrowUp size={15} strokeWidth={2.4} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon"
              className="send-behavior-chevron size-5 rounded-none border-l border-primary-foreground/20 text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              aria-label={t("app.sendBehaviorTitle")} title={t("app.sendBehaviorTitle")}
              aria-haspopup="menu"
              aria-expanded={props.sendBehaviorMenuOpen}
              onMouseEnter={props.onKeepBehaviorMenuOpen}
              onFocus={props.onKeepBehaviorMenuOpen}
              onClick={props.onToggleBehaviorMenu}
            >
              <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
            </Button>
          </div>
        )}
        {props.isAgentBusy ? (
          <Button variant="ghost" size="icon"
            className="composer-bar-btn stop size-8 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            aria-label={t("app.stop")} title={t("app.stop")}
            onClick={props.onStop}
          >
            <Square size={15} strokeWidth={0} fill="currentColor" aria-hidden="true" />
          </Button>
        ) : !props.keepBusyDraftControls ? (
          <Button variant="ghost" size="icon"
            className="composer-bar-btn send size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground disabled:opacity-40"
            aria-label={t("app.send")} title={t("app.send")}
            disabled={props.isAgentStarting || !props.canSend}
            onClick={props.onSend}
          >
            <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
          </Button>
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
                size="sm"
                className="send-behavior-option steer justify-start gap-2 px-2"
                role="menuitem"
                onClick={props.onSend}
              >
                <span className="send-behavior-option-dot size-1.5 rounded-full bg-foreground" aria-hidden="true" />
                <span>{t("app.sendSteerTitle")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
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
