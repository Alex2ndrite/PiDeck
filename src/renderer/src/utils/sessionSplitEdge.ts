/**
 * 会话 Tab 拖到聊天区边缘时的分屏落点解析。
 * 外圈比例内命中最近边；中心区域不触发分屏（留给「替换当前」等后续扩展）。
 */

export type SessionSplitEdge = "left" | "right" | "top" | "bottom";

export type SessionSplitOrientation = "horizontal" | "vertical";

/** 与 SessionTabsBar 共用的拖拽 MIME，便于跨组件识别会话 Tab 拖拽。 */
export const SESSION_TAB_DRAG_MIME = "text/pideck-session-tab";

/** 边缘热区占容器宽/高的比例（外 28%）。 */
export const SESSION_SPLIT_EDGE_THRESHOLD = 0.28;

export type SessionSplitLayout = {
  /** 左（水平）或上（垂直） */
  firstSessionId: string;
  /** 右（水平）或下（垂直） */
  secondSessionId: string;
  orientation: SessionSplitOrientation;
};

/**
 * 根据指针相对容器矩形的位置，解析分屏落点边。
 * @returns 命中边，或中心区域时返回 null
 */
export function resolveSessionSplitEdge(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  thresholdRatio = SESSION_SPLIT_EDGE_THRESHOLD,
): SessionSplitEdge | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const distLeft = x;
  const distRight = 1 - x;
  const distTop = y;
  const distBottom = 1 - y;
  const nearest = Math.min(distLeft, distRight, distTop, distBottom);
  if (nearest > thresholdRatio) return null;

  if (nearest === distLeft) return "left";
  if (nearest === distRight) return "right";
  if (nearest === distTop) return "top";
  return "bottom";
}

/** 落点边 → 布局方向 */
export function edgeToOrientation(edge: SessionSplitEdge): SessionSplitOrientation {
  return edge === "left" || edge === "right" ? "horizontal" : "vertical";
}

/**
 * 单栏分屏时的宿主会话：另一栏要保留谁。
 * - 拖的不是当前焦点 → 宿主=当前焦点（常见：拖第二个 Tab / 侧栏其它会话）
 * - 拖的就是当前焦点 → 宿主=Tab 栏里另一个会话（否则「当前 Tab 无法分屏」）
 * - 只有自己一个 Tab 且拖的是自己 → 无法分屏，返回 null
 */
export function resolveSplitHostSessionId(input: {
  currentSessionId: string | undefined;
  draggedSessionId: string;
  tabIds: readonly string[];
}): string | null {
  const { currentSessionId, draggedSessionId, tabIds } = input;
  if (!draggedSessionId) return null;
  if (currentSessionId && currentSessionId !== draggedSessionId) {
    return currentSessionId;
  }
  const other = tabIds.find((id) => id && id !== draggedSessionId);
  return other ?? null;
}

/**
 * 在「当前仅一个会话」时，用拖入会话 + 落点边生成双栏布局。
 * 拖入会话放在落点侧；宿主会话（host）占据另一侧。
 */
export function buildSplitLayoutFromDrop(input: {
  hostSessionId: string;
  draggedSessionId: string;
  edge: SessionSplitEdge;
}): SessionSplitLayout | null {
  const { hostSessionId, draggedSessionId, edge } = input;
  if (!hostSessionId || !draggedSessionId || hostSessionId === draggedSessionId) {
    return null;
  }
  const orientation = edgeToOrientation(edge);
  if (edge === "left" || edge === "top") {
    return {
      firstSessionId: draggedSessionId,
      secondSessionId: hostSessionId,
      orientation,
    };
  }
  return {
    firstSessionId: hostSessionId,
    secondSessionId: draggedSessionId,
    orientation,
  };
}

/**
 * 已分屏时拖入第三个会话：替换落点侧的那一栏；若拖的是已在分屏内的会话则忽略。
 */
export function replaceSplitPaneFromDrop(input: {
  layout: SessionSplitLayout;
  draggedSessionId: string;
  edge: SessionSplitEdge;
}): SessionSplitLayout | null {
  const { layout, draggedSessionId, edge } = input;
  if (
    !draggedSessionId ||
    draggedSessionId === layout.firstSessionId ||
    draggedSessionId === layout.secondSessionId
  ) {
    return null;
  }
  const nextOrientation = edgeToOrientation(edge);
  if (edge === "left" || edge === "top") {
    return {
      firstSessionId: draggedSessionId,
      secondSessionId: layout.secondSessionId,
      orientation: nextOrientation,
    };
  }
  return {
    firstSessionId: layout.firstSessionId,
    secondSessionId: draggedSessionId,
    orientation: nextOrientation,
  };
}

/**
 * 焦点会话变更为分屏外会话时（新建 Agent / 侧栏打开第三会话 / 点分屏外 Tab），
 * 把新会话替换进「变更前焦点所在的那一栏」，保持「聚焦栏展示当前会话」的语义。
 * - 新会话已在分屏内 → 只切焦点，不改布局，返回 null
 * - 变更前焦点不在任何栏（焦点游离，如切项目后直接新建）→ 退化为替换 first 栏，保证新会话可见
 */
export function replaceSplitPaneFromFocus(input: {
  layout: SessionSplitLayout;
  prevFocusedSessionId: string | undefined;
  nextFocusedSessionId: string;
}): SessionSplitLayout | null {
  const { layout, prevFocusedSessionId, nextFocusedSessionId } = input;
  if (
    nextFocusedSessionId === layout.firstSessionId ||
    nextFocusedSessionId === layout.secondSessionId
  ) {
    return null;
  }
  if (layout.firstSessionId === prevFocusedSessionId) {
    return { ...layout, firstSessionId: nextFocusedSessionId };
  }
  if (layout.secondSessionId === prevFocusedSessionId) {
    return { ...layout, secondSessionId: nextFocusedSessionId };
  }
  return { ...layout, firstSessionId: nextFocusedSessionId };
}

/** 关闭某一栏后：若还剩一栏则退回单栏（返回幸存 sessionId）；两栏都无效则 null。 */
export function resolveSplitAfterClose(
  layout: SessionSplitLayout,
  closedSessionId: string,
): { soloSessionId: string } | { layout: SessionSplitLayout } | null {
  const firstGone = layout.firstSessionId === closedSessionId;
  const secondGone = layout.secondSessionId === closedSessionId;
  if (!firstGone && !secondGone) return { layout };
  if (firstGone && secondGone) return null;
  if (firstGone) return { soloSessionId: layout.secondSessionId };
  return { soloSessionId: layout.firstSessionId };
}
