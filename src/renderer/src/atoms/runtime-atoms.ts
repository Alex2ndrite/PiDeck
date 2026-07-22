import { atom } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";
import type { AgentRuntimeState, AgentTab } from "../../../shared/types";
import { mergeAgentRuntimeState } from "../utils/agentRuntimeState";

export const agentInventoryByIdAtom = atom<Record<string, AgentTab>>({});
export const agentInventoryOrderAtom = atom<string[]>([]);
export const runtimeCapabilitiesByAgentIdAtom = atom<Record<string, AgentRuntimeState>>({});

export const agentInventoryAtom = atom((get) => {
  const inventory = get(agentInventoryByIdAtom);
  return get(agentInventoryOrderAtom)
    .map((agentId) => inventory[agentId])
    .filter((agent): agent is AgentTab => Boolean(agent));
});

export const replaceAgentInventoryAtom = atom(
  null,
  (_get, set, agents: AgentTab[]) => {
    const inventory: Record<string, AgentTab> = {};
    for (const agent of agents) inventory[agent.id] = agent;
    const liveAgentIds = new Set(agents.map((agent) => agent.id));
    set(agentInventoryByIdAtom, inventory);
    set(agentInventoryOrderAtom, agents.map((agent) => agent.id));
    set(runtimeCapabilitiesByAgentIdAtom, (current) => Object.fromEntries(
      Object.entries(current).filter(([agentId]) => liveAgentIds.has(agentId)),
    ));
  },
);

export const upsertAgentInventoryAtom = atom(
  null,
  (get, set, agent: AgentTab) => {
    set(agentInventoryByIdAtom, {
      ...get(agentInventoryByIdAtom),
      [agent.id]: agent,
    });
    const order = get(agentInventoryOrderAtom);
    if (!order.includes(agent.id)) set(agentInventoryOrderAtom, [...order, agent.id]);
  },
);

export const applyRuntimeCapabilityAtom = atom(
  null,
  (get, set, input: { agentId: string; state: AgentRuntimeState }) => {
    const current = get(runtimeCapabilitiesByAgentIdAtom);
    const state = mergeAgentRuntimeState(current[input.agentId], input.state);
    set(runtimeCapabilitiesByAgentIdAtom, {
      ...current,
      [input.agentId]: state,
    });
    return state;
  },
);

export const agentByIdAtomFamily = atomFamily((agentId: string) =>
  atom((get) => get(agentInventoryByIdAtom)[agentId]),
);

export const agentsByProjectIdAtomFamily = atomFamily((projectId: string) =>
  atom((get) => get(agentInventoryAtom).filter((agent) => agent.projectId === projectId)),
);

export const runtimeCapabilityByAgentIdAtomFamily = atomFamily((agentId: string) =>
  atom((get) => get(runtimeCapabilitiesByAgentIdAtom)[agentId]),
);

// Preserve the project record while its agent IDs and capability object references are unchanged.
function areRuntimeCapabilityRecordsEqual(
  left: Record<string, AgentRuntimeState>,
  right: Record<string, AgentRuntimeState>,
): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length &&
    leftIds.every((agentId) => left[agentId] === right[agentId]);
}

export const runtimeCapabilitiesByProjectIdAtomFamily = atomFamily((projectId: string) => {
  const projectCapabilitiesAtom = atom((get) => Object.fromEntries(
    get(agentsByProjectIdAtomFamily(projectId))
      .map((agent) => [
        agent.id,
        get(runtimeCapabilityByAgentIdAtomFamily(agent.id)),
      ] as const)
      .filter((entry): entry is readonly [string, AgentRuntimeState] => Boolean(entry[1])),
  ));
  return selectAtom(
    projectCapabilitiesAtom,
    (capabilities) => capabilities,
    areRuntimeCapabilityRecordsEqual,
  );
});
