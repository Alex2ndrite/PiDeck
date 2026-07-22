import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import type {
  AgentRuntimeState,
  AgentTab,
  AppSettings,
  AppUpdateDownloadProgress,
  Project,
} from "../../../shared/types";
import {
  applyRuntimeCapabilityAtom,
  replaceAgentInventoryAtom,
  replaceProjectInventoryAtom,
  runtimeCapabilityByAgentIdAtomFamily,
} from "../atoms";
import { desktopApi } from "../desktopApi";

type GlobalAgentListenerCallbacks = {
  onProjectsChanged?: (projects: Project[]) => void;
  onAgentInventoryChanged?: (agents: AgentTab[]) => void;
  onRuntimeCapabilityChanged?: (input: {
    agentId: string;
    previous?: AgentRuntimeState;
    current: AgentRuntimeState;
    patch: AgentRuntimeState;
  }) => void;
  onAgentLog?: (payload: { agentId: string; text: string }) => void;
  onFocusTarget?: (target: { agentId: string }) => void;
  onSettingsApplied?: (settings: AppSettings) => void;
  onUpdateProgress?: (progress: AppUpdateDownloadProgress) => void;
  onOpenInBrowser?: (url: string) => void;
  onTrustRequest?: (request: {
    requestId: string;
    cwd: string;
    projectName: string;
  }) => void;
};

export function useGlobalAgentListeners(
  callbacks: GlobalAgentListenerCallbacks = {},
): void {
  const store = useStore();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let disposed = false;

    void desktopApi.projects.list().then((projects) => {
      if (disposed) return;
      store.set(replaceProjectInventoryAtom, projects);
      callbacksRef.current.onProjectsChanged?.(projects);
    }).catch(() => undefined);
    void desktopApi.agents.list().then((agents) => {
      if (disposed) return;
      store.set(replaceAgentInventoryAtom, agents);
      callbacksRef.current.onAgentInventoryChanged?.(agents);
    }).catch(() => undefined);

    const offProjects = desktopApi.projects.onChanged((projects) => {
      store.set(replaceProjectInventoryAtom, projects);
      callbacksRef.current.onProjectsChanged?.(projects);
    });
    const offState = desktopApi.agents.onState((agents) => {
      store.set(replaceAgentInventoryAtom, agents);
      callbacksRef.current.onAgentInventoryChanged?.(agents);
    });
    const offRuntimeState = desktopApi.agents.onRuntimeState((payload) => {
      const previous = store.get(runtimeCapabilityByAgentIdAtomFamily(payload.agentId));
      const current = store.set(applyRuntimeCapabilityAtom, payload);
      callbacksRef.current.onRuntimeCapabilityChanged?.({
        agentId: payload.agentId,
        previous,
        current,
        patch: payload.state,
      });
    });
    const offLog = desktopApi.agents.onLog((payload) => {
      callbacksRef.current.onAgentLog?.(payload);
    });
    const offFocusTarget = desktopApi.agents.onFocusTarget((target) => {
      callbacksRef.current.onFocusTarget?.(target);
    });
    const offSettings = desktopApi.settings.onApplyWindow((settings) => {
      callbacksRef.current.onSettingsApplied?.(settings);
    });
    const offUpdateProgress = desktopApi.app.onUpdateProgress((progress) => {
      callbacksRef.current.onUpdateProgress?.(progress);
    });
    const offOpenInBrowser = desktopApi.app.onOpenInBrowser?.((url) => {
      callbacksRef.current.onOpenInBrowser?.(url);
    });
    const offTrustRequest = desktopApi.agents.onTrustRequest((request) => {
      callbacksRef.current.onTrustRequest?.(request);
    });

    return () => {
      disposed = true;
      offProjects();
      offState();
      offRuntimeState();
      offLog();
      offFocusTarget();
      offSettings();
      offUpdateProgress();
      offOpenInBrowser?.();
      offTrustRequest();
    };
  }, [store]);
}
