import { useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "../../../../preload";
import { TerminalDock } from "../terminal/TerminalDock";

export const SESSION_RUNTIME_DOCK_MOTION_MS = 180;

export type SessionRuntimeDockMotionState = Readonly<{
  mounted: boolean;
  closing: boolean;
  agentId?: string;
}>;

export const CLOSED_SESSION_RUNTIME_DOCK: SessionRuntimeDockMotionState = {
  mounted: false,
  closing: false,
};

export function transitionSessionRuntimeDock(
  current: SessionRuntimeDockMotionState,
  input: { agentId?: string; open: boolean },
): SessionRuntimeDockMotionState {
  if (input.open && input.agentId) {
    return { mounted: true, closing: false, agentId: input.agentId };
  }
  if (!current.mounted) return CLOSED_SESSION_RUNTIME_DOCK;
  return { mounted: true, closing: true, agentId: current.agentId };
}

export function finishSessionRuntimeDockClose(
  current: SessionRuntimeDockMotionState,
): SessionRuntimeDockMotionState {
  return current.closing ? CLOSED_SESSION_RUNTIME_DOCK : current;
}

export function disposeSessionRuntimeDock(): SessionRuntimeDockMotionState {
  return CLOSED_SESSION_RUNTIME_DOCK;
}

export type SessionRuntimeDockProps = {
  agentId?: string;
  open: boolean;
  collapsed: boolean;
  height: number;
  terminal: PiDesktopApi["terminal"];
  onOpenChange: (open: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onHeightChange: (height: number) => void;
  /** Read-only layout signal. The dock remains the sole owner of close animation state. */
  onMotionStateChange?: (state: SessionRuntimeDockMotionState) => void;
};

// The dock tracks a runtime, not the Session view. Losing or replacing a runtime only closes this leaf.
export function SessionRuntimeDock(props: SessionRuntimeDockProps) {
  const [motion, setMotion] = useState<SessionRuntimeDockMotionState>(
    CLOSED_SESSION_RUNTIME_DOCK,
  );
  const motionRef = useRef(motion);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const onMotionStateChangeRef = useRef(props.onMotionStateChange);
  onMotionStateChangeRef.current = props.onMotionStateChange;

  function publish(next: SessionRuntimeDockMotionState) {
    motionRef.current = next;
    setMotion(next);
    onMotionStateChangeRef.current?.(next);
  }

  function clearCloseTimer() {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  useEffect(() => {
    clearCloseTimer();
    const next = transitionSessionRuntimeDock(motionRef.current, {
      agentId: props.agentId,
      open: props.open,
    });
    publish(next);
    if (!next.closing) return clearCloseTimer;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      publish(finishSessionRuntimeDockClose(motionRef.current));
    }, SESSION_RUNTIME_DOCK_MOTION_MS);
    return clearCloseTimer;
  // Motion is intentionally held in a ref so props changes do not create a second close timer owner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId, props.open]);

  useEffect(() => () => {
    clearCloseTimer();
    publish(disposeSessionRuntimeDock());
  // publish only reads stable refs and setState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!motion.mounted || !motion.agentId) return null;
  return (
    <TerminalDock
      key={motion.agentId}
      agentId={motion.agentId}
      open={motion.mounted}
      closing={motion.closing}
      collapsed={props.collapsed}
      height={props.height}
      terminal={props.terminal}
      onCollapsedChange={props.onCollapsedChange}
      onHeightChange={props.onHeightChange}
      onClose={() => props.onOpenChange(false)}
    />
  );
}
