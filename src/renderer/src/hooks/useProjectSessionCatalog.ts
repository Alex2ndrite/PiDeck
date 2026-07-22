import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  replaceProjectSessionsAtom,
  sessionCatalogLoadStateAtom,
  sessionIdsByProjectAtom,
  sessionRecordsAtom,
  setSessionCatalogLoadStateAtom,
} from "../atoms";

let nextCatalogLoadSequence = 0;
const latestCatalogLoadByProject = new Map<string, number>();

export function useProjectSessionCatalog(
  projectId: string | undefined,
  enabled = true,
) {
  const records = useAtomValue(sessionRecordsAtom);
  const idsByProject = useAtomValue(sessionIdsByProjectAtom);
  const loadStates = useAtomValue(sessionCatalogLoadStateAtom);
  const replaceSessions = useSetAtom(replaceProjectSessionsAtom);
  const setLoadState = useSetAtom(setSessionCatalogLoadStateAtom);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastLoadKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!projectId || !enabled) return;
    const loadKey = `${projectId}:${refreshVersion}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;
    const sequence = ++nextCatalogLoadSequence;
    latestCatalogLoadByProject.set(projectId, sequence);
    setLoadState({ projectId, state: { status: "loading" } });
    void window.piDesktop.sessions.listCatalog(projectId)
      .then((sessions) => {
        if (latestCatalogLoadByProject.get(projectId) !== sequence) return;
        replaceSessions({ projectId, sessions });
        setLoadState({ projectId, state: { status: "ready" } });
      })
      .catch((error) => {
        if (latestCatalogLoadByProject.get(projectId) !== sequence) return;
        setLoadState({
          projectId,
          state: {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }, [enabled, projectId, refreshVersion, replaceSessions, setLoadState]);

  const sessions = useMemo(
    () => (projectId ? (idsByProject[projectId] ?? []).map((id) => records[id]).filter(Boolean) : []),
    [idsByProject, projectId, records],
  );
  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);
  const state = projectId ? loadStates[projectId] : undefined;

  return {
    sessions,
    isLoading: state?.status === "loading",
    error: state?.status === "error" ? state.error : undefined,
    refresh,
  };
}
