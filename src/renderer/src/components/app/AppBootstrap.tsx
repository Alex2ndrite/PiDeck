import React from "react";
import { useGlobalAgentListeners } from "../../hooks/useGlobalAgentListeners";
import type { AppSettings, AgentTab, AgentRuntimeState, Project } from "../../../../shared/types";

interface AppBootstrapProps {
  onProjectsChanged: (projects: Project[]) => void;
  onAgentInventoryChanged: (agents: AgentTab[]) => void;
  onSettingsApplied: (settings: AppSettings) => void;
  onOpenInBrowser: (url: string) => void;
  onTrustRequest: (req: { requestId: string; cwd: string; projectName: string }) => void;
  onFocusTarget: (target: { agentId: string }) => void;
  queueFlushSteer: (agentId: string) => void;
}

/** Bootstrap — sets up global IPC listeners, renders nothing. */
export const AppBootstrap = React.memo(function AppBootstrap(props: AppBootstrapProps) {
  useGlobalAgentListeners({
    onProjectsChanged: props.onProjectsChanged,
    onAgentInventoryChanged: props.onAgentInventoryChanged,
    onRuntimeCapabilityChanged: ({ agentId, previous, current, patch }: {
      agentId: string;
      previous?: AgentRuntimeState;
      current: AgentRuntimeState;
      patch: AgentRuntimeState;
    }) => {
      if (
        previous?.isExecutingTool &&
        !current.isExecutingTool &&
        (patch.toolStateSequence == null ||
          previous.toolStateSequence == null ||
          patch.toolStateSequence >= previous.toolStateSequence)
      ) {
        props.queueFlushSteer(agentId);
      }
    },
    onAgentLog: () => undefined,
    onSettingsApplied: props.onSettingsApplied,
    onUpdateProgress: () => undefined,
    onOpenInBrowser: props.onOpenInBrowser,
    onTrustRequest: props.onTrustRequest,
    onFocusTarget: props.onFocusTarget,
  });

  return null;
});
