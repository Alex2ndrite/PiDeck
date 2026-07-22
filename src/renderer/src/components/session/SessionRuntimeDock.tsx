import { useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "../../../../preload";
import { TerminalDock } from "../terminal/TerminalDock";

export const SESSION_RUNTIME_DOCK_MOTION_MS = 180;

export type SessionRuntimeDockProps = {
  agentId?: string;
  open: boolean;
  collapsed: boolean;
  height: number;
  terminal: PiDesktopApi["terminal"];
  onOpenChange: (open: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onHeightChange: (height: number) => void;
};

// The dock tracks a runtime, not the Session view. Losing or replacing a runtime only closes this leaf.
export function SessionRuntimeDock(props: SessionRuntimeDockProps) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mountedAgentId, setMountedAgentId] = useState<string>();
  const closeTimerRef = useRef<number | undefined>(undefined);
  const shouldBeOpen = Boolean(props.agentId && props.open);

  useEffect(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    if (shouldBeOpen && props.agentId) {
      setMountedAgentId(props.agentId);
      setClosing(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
      setMountedAgentId(undefined);
      closeTimerRef.current = undefined;
    }, SESSION_RUNTIME_DOCK_MOTION_MS);
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = undefined;
      }
    };
  }, [mounted, props.agentId, shouldBeOpen]);

  if (!mounted || !mountedAgentId) return null;
  return (
    <TerminalDock
      key={mountedAgentId}
      agentId={mountedAgentId}
      open={mounted}
      closing={closing}
      collapsed={props.collapsed}
      height={props.height}
      terminal={props.terminal}
      onCollapsedChange={props.onCollapsedChange}
      onHeightChange={props.onHeightChange}
      onClose={() => props.onOpenChange(false)}
    />
  );
}
