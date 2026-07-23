import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  sessionRuntimeBySessionIdAtomFamily,
  sessionRuntimeUiBySessionIdAtomFamily,
} from "../../atoms";
import { useFeishuBridge } from "../../hooks/useFeishuBridge";
import { FeishuLinkIndicator } from "../feishu/FeishuLinkIndicator";
import { ExtensionWidgetCard } from "../app/AppParts";

const DISMISSED_WIDGETS_KEY = "pid:session-composer-dismissed-widgets";

export type RuntimeHandle = {
  agentId: string;
  runtimeGeneration: number;
};

export function sameRuntimeHandle(
  left: RuntimeHandle | undefined,
  right: RuntimeHandle | undefined,
): boolean {
  return left?.agentId === right?.agentId &&
    left?.runtimeGeneration === right?.runtimeGeneration;
}

export function widgetDismissalScope(
  sessionId: string,
  runtimeGeneration: number | undefined,
): string {
  return `${sessionId}:${runtimeGeneration ?? "detached"}`;
}

export function isCoherentComposerRuntimeUi(
  runtime: RuntimeHandle | undefined,
  runtimeUi: { agentId: string; runtimeGeneration: number } | undefined,
): boolean {
  return Boolean(
    runtime &&
    runtimeUi &&
    runtimeUi.agentId === runtime.agentId &&
    runtimeUi.runtimeGeneration === runtime.runtimeGeneration,
  );
}

function loadDismissedWidgets(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_WIDGETS_KEY) ?? "{}");
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, string[]>
      : {};
  } catch {
    return {};
  }
}

function persistDismissedWidgets(value: Record<string, string[]>) {
  try {
    localStorage.setItem(DISMISSED_WIDGETS_KEY, JSON.stringify(value));
  } catch {
    // Storage is optional in preview/test runtimes.
  }
}

export type ComposerRuntimeSlots = {
  widgets: ReactNode;
  feishuIndicator: ReactNode;
};

export function ComposerRuntimeIntegrations(props: {
  sessionId: string;
  widgetsCollapsed?: boolean;
  children: (slots: ComposerRuntimeSlots) => ReactNode;
}) {
  const runtime = useAtomValue(
    sessionRuntimeBySessionIdAtomFamily(props.sessionId),
  );
  const runtimeUi = useAtomValue(
    sessionRuntimeUiBySessionIdAtomFamily(props.sessionId),
  );
  const feishu = useFeishuBridge();
  const [sessionBotId, setSessionBotId] = useState<string>();
  const [dismissedBySession, setDismissedBySession] = useState(loadDismissedWidgets);
  const botRequestSequenceRef = useRef(0);
  const runtimeHandleRef = useRef<RuntimeHandle | undefined>(undefined);
  const runtimeHandle = runtime?.agentId
    ? {
        agentId: runtime.agentId,
        runtimeGeneration: runtime.runtimeGeneration,
      }
    : undefined;
  runtimeHandleRef.current = runtimeHandle;

  useEffect(() => {
    const sequence = ++botRequestSequenceRef.current;
    setSessionBotId(undefined);
    if (!runtimeHandle) return;
    const expected = runtimeHandle;
    void feishu.getSessionBot(expected.agentId).then((botId) => {
      if (
        sequence === botRequestSequenceRef.current &&
        sameRuntimeHandle(runtimeHandleRef.current, expected)
      ) {
        setSessionBotId(botId);
      }
    }).catch(() => undefined);
  }, [
    props.sessionId,
    runtimeHandle?.agentId,
    runtimeHandle?.runtimeGeneration,
    feishu.bindings,
  ]);

  useEffect(() => {
    if (!sessionBotId) return;
    if (!feishu.bots.some((bot) => bot.id === sessionBotId)) {
      setSessionBotId(undefined);
    }
  }, [feishu.bots, sessionBotId]);

  const coherentRuntimeUi = isCoherentComposerRuntimeUi(runtimeHandle, runtimeUi)
    ? runtimeUi
    : undefined;
  const dismissalScope = widgetDismissalScope(
    props.sessionId,
    runtimeHandle?.runtimeGeneration,
  );
  const dismissed = dismissedBySession[dismissalScope] ?? [];
  const widgets = coherentRuntimeUi?.widgets ?? {};

  function dismissWidget(widgetKey: string) {
    setDismissedBySession((current) => {
      const existing = current[dismissalScope] ?? [];
      if (existing.includes(widgetKey)) return current;
      const next = {
        ...current,
        [dismissalScope]: [...existing, widgetKey],
      };
      persistDismissedWidgets(next);
      return next;
    });
  }

  async function setRuntimeBot(_agentId: string, botId: string | null) {
    const expected = runtimeHandleRef.current;
    if (!expected) return;
    await feishu.setSessionBot(expected.agentId, botId);
    if (sameRuntimeHandle(runtimeHandleRef.current, expected)) {
      setSessionBotId(botId ?? undefined);
    }
  }

  const widgetSlot = props.widgetsCollapsed || Object.keys(widgets).length === 0
    ? null
    : (
        <div className="extension-widgets-container">
          {Object.entries(widgets)
            .filter(([widgetKey]) => !dismissed.includes(widgetKey))
            .map(([widgetKey, lines]) => (
              <ExtensionWidgetCard
                key={`${props.sessionId}:${runtimeHandle?.runtimeGeneration}:${widgetKey}`}
                widgetKey={widgetKey}
                lines={lines}
                sessionIdOrPath={props.sessionId}
                onClose={() => dismissWidget(widgetKey)}
              />
            ))}
        </div>
      );
  const feishuSlot = feishu.bots.length > 0 && runtimeHandle ? (
    <FeishuLinkIndicator
      status={feishu.status}
      bots={feishu.bots}
      activeAgentId={runtimeHandle.agentId}
      activeBotId={feishu.activeBotId}
      sessionBotId={sessionBotId}
      isConnected={feishu.isConnected}
      connecting={feishu.connecting}
      onConnectByBot={feishu.connectByBot}
      onDisconnect={feishu.disconnect}
      onSetSessionBot={setRuntimeBot}
    />
  ) : null;

  return <>{props.children({ widgets: widgetSlot, feishuIndicator: feishuSlot })}</>;
}
