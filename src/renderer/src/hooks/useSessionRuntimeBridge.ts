import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { applySessionRuntimeEventAtom } from "../atoms";
import { desktopApi } from "../desktopApi";

export function useSessionRuntimeBridge(): void {
  const applyRuntimeEvent = useSetAtom(applySessionRuntimeEventAtom);

  useEffect(() => {
    return desktopApi.sessions.onRuntimeEvent((event) => {
      applyRuntimeEvent(event);
    });
  }, [applyRuntimeEvent]);
}
