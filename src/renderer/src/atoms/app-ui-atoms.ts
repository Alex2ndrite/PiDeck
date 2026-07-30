import { atom } from "jotai";
import {
  defaultExpandedSidebarProjects,
  readExpandedSidebarProjects,
} from "../utils/sidebarExpandedProjects";

/** Settings overlay visibility is shared by Sidebar, Pi environment flow, and Session surface. */
export const settingsOpenAtom = atom(false);

/**
 * 侧栏展开的项目 id 集合（有 id = 展开）。
 * Shared because project collapse also pauses App-level session polling.
 * 初值取 localStorage 首屏缓存，随后由 settings.json 覆盖为权威值。
 */
export const sidebarExpandedProjectIdsAtom = atom<ReadonlySet<string>>(
  (() => {
    const cached = readExpandedSidebarProjects(
      typeof window === "undefined" ? undefined : window.localStorage,
    );
    return cached ? new Set(cached) : defaultExpandedSidebarProjects();
  })(),
);

/**
 * 实验开关：助手消息使用 Streamdown 渲染引擎（UI 2.0 / issue #115 U2 灰度）。
 * 由 App 在 settings 加载/变更时同步；默认 false 走旧 react-markdown 管线。
 */
export const useStreamdownRendererAtom = atom(false);
