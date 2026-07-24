import { atom } from "jotai";

/** Settings overlay visibility is shared by Sidebar, Pi environment flow, and Session surface. */
export const settingsOpenAtom = atom(false);

/** Shared because project collapse also pauses App-level session polling. */
export const sidebarCollapsedProjectIdsAtom = atom<ReadonlySet<string>>(new Set<string>());
