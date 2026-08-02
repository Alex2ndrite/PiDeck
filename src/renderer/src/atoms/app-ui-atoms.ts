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

// useStreamdownRendererAtom 已移除：Streamdown 转正为唯一 markdown 引擎（迁移 react-markdown 完成）。

/**
 * 实验开关：内置浏览器走 WebContentsView 管线（UI 2.0 / issue #115 U4 灰度）。
 * 由 App 在 settings 加载/变更时同步；默认 false 走 <webview>。
 */
export const useWebContentsViewBrowserAtom = atom(false);
