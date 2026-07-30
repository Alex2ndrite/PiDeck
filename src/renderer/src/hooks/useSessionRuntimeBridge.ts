import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import type { AgentRuntimeState } from "../../../shared/types";
import {
  applySessionRuntimeEventAtom,
  replaceSessionRuntimesAtom,
  sessionRuntimeByIdAtom,
} from "../atoms";
import { desktopApi } from "../desktopApi";

type RuntimeBridgeCallbacks = {
  onRuntimeCapabilityChanged?: (input: {
    sessionId: string;
    agentId: string;
    previous?: AgentRuntimeState;
    current: AgentRuntimeState;
    patch: AgentRuntimeState;
  }) => void;
};

export function useSessionRuntimeBridge(callbacks: RuntimeBridgeCallbacks = {}): void {
  const store = useStore();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let disposed = false;
    void desktopApi.sessions.listRuntimes().then((runtimes) => {
      if (!disposed) store.set(replaceSessionRuntimesAtom, runtimes);
    }).catch(() => undefined);

    const offRuntimeEvents = desktopApi.sessions.onRuntimeEvent((event) => {
      const previousRuntime = store.get(sessionRuntimeByIdAtom)[event.sessionId];
      store.set(applySessionRuntimeEventAtom, event);
      if (event.sourceChannel !== "agents:runtime-state") return;
      const currentRuntime = store.get(sessionRuntimeByIdAtom)[event.sessionId];
      if (
        currentRuntime?.agentId !== event.agentId ||
        currentRuntime.runtimeGeneration !== event.runtimeGeneration ||
        !currentRuntime.state ||
        !event.payload ||
        typeof event.payload !== "object"
      ) {
        return;
      }
      const patch = (event.payload as { state?: AgentRuntimeState }).state;
      if (!patch) return;
      callbacksRef.current.onRuntimeCapabilityChanged?.({
        sessionId: event.sessionId,
        agentId: event.agentId,
        previous: previousRuntime?.agentId === event.agentId &&
          previousRuntime.runtimeGeneration === event.runtimeGeneration
          ? previousRuntime.state
          : undefined,
        current: currentRuntime.state,
        patch,
      });
    });
    return () => {
      disposed = true;
      offRuntimeEvents();
    };
  }, [store]);
}
