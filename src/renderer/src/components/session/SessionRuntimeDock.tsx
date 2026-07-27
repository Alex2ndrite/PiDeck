import type { PiDesktopApi } from "../../../../preload";
import type { SessionRuntimeTarget } from "../../../../shared/types";
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
  target?: SessionRuntimeTarget;
  mounted: boolean;
  open: boolean;
  closing: boolean;
  collapsed: boolean;
  height: number;
  terminal: PiDesktopApi["terminal"];
  onOpenChange: (open: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onHeightChange: (height: number) => void;
};

// Motion state is owned by useTerminalDock. This leaf only forwards the already
// computed mounted/open/closing signals to the expensive terminal surface.
export function SessionRuntimeDock(props: SessionRuntimeDockProps) {
  if (!props.mounted || !props.target) return null;
  return (
    <TerminalDock
      key={`${props.target.agentId}:${props.target.runtimeGeneration}`}
      target={props.target}
      open={props.open}
      closing={props.closing}
      collapsed={props.collapsed}
      height={props.height}
      terminal={props.terminal}
      onCollapsedChange={props.onCollapsedChange}
      onHeightChange={props.onHeightChange}
      onClose={() => props.onOpenChange(false)}
    />
  );
}
