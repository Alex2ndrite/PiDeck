import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { applySessionRuntimeEventAtom } from "../atoms";

export function useSessionRuntimeBridge(): void {
  const applyRuntimeEvent = useSetAtom(applySessionRuntimeEventAtom);

  useEffect(() => {
    return window.piDesktop.sessions.onRuntimeEvent((event) => {
      applyRuntimeEvent(event);
    });
  }, [applyRuntimeEvent]);
}
