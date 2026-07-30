import { useState } from "react";

// Keep the default workbench geometry aligned with the main dev branch. The
// Session-first change only affects when a runtime begins, not sidebar width.
const DEFAULT_LIST_WIDTH = 221;

/**
 * 侧栏宽度/折叠状态（#115 U5 起拖拽交互由 react-resizable-panels 承担，
 * 本 hook 只保留状态与折叠切换；composer 拖拽逻辑已随布局换装删除）。
 */
export function useResize() {
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [listCollapsed, setListCollapsed] = useState(false);

  function toggleListCollapsed() {
    const nextCollapsed = !listCollapsed;
    if (!nextCollapsed) setListWidth(DEFAULT_LIST_WIDTH);
    if (nextCollapsed) {
      // 收起后焦点仍可能留在侧栏中的控件上；先释放，避免隐藏内容保留键盘焦点。
      (document.activeElement as HTMLElement | null)?.blur();
    }
    setListCollapsed(nextCollapsed);
  }

  return {
    listWidth,
    setListWidth,
    listCollapsed,
    setListCollapsed,
    DEFAULT_LIST_WIDTH,
    toggleListCollapsed,
  };
}
