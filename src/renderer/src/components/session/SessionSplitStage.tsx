import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui-shadcn/resizable";
import { t } from "../../i18n";
import {
  SESSION_TAB_DRAG_MIME,
  resolveSessionSplitEdge,
  type SessionSplitEdge,
  type SessionSplitLayout,
} from "../../utils/sessionSplitEdge";

export type SessionSplitStageProps = {
  /** 当前分屏布局；null 表示单栏 */
  layout: SessionSplitLayout | null;
  /** 正在拖拽的会话 Tab id；无拖拽时不显示落点预览 */
  draggingSessionId: string | null;
  onDropSplit: (draggedSessionId: string, edge: SessionSplitEdge) => void;
  /** 单栏内容；分屏时忽略 */
  solo: ReactNode;
  /** 分屏左/上 */
  first: ReactNode;
  /** 分屏右/下 */
  second: ReactNode;
};

function isSessionTabDrag(event: React.DragEvent, draggingSessionId: string | null): boolean {
  if (draggingSessionId) return true;
  // dragover 阶段自定义 MIME 可读 types（getData 在部分浏览器为空）
  return event.dataTransfer.types.includes(SESSION_TAB_DRAG_MIME);
}

/**
 * 会话区分屏舞台：边缘落点预览 + 双栏可拖拽分隔。
 * 只负责几何与呈现；分屏策略由 onDropSplit（workspace chrome）决定。
 *
 * 用 capture 阶段拦截会话 Tab 拖拽，避免 composer / timeline 的 dragOver
 * 抢走 drop（表现为边缘预览有了、松手却没反应）。
 */
export function SessionSplitStage(props: SessionSplitStageProps) {
  const {
    layout,
    draggingSessionId,
    onDropSplit,
    solo,
    first,
    second,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hoverEdge, setHoverEdge] = useState<SessionSplitEdge | null>(null);

  const clearHover = useCallback(() => setHoverEdge(null), []);

  // Tab/侧栏的 dragend 发生在舞台外；chrome 清 draggingSessionId 时必须同步清预览，
  // 否则取消拖拽后边缘遮罩可能残留。
  useEffect(() => {
    if (!draggingSessionId) clearHover();
  }, [draggingSessionId, clearHover]);

  const handleDragOverCapture = useCallback(
    (event: React.DragEvent) => {
      if (!isSessionTabDrag(event, draggingSessionId)) return;
      const root = rootRef.current;
      if (!root) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const edge = resolveSessionSplitEdge(
        event.clientX,
        event.clientY,
        root.getBoundingClientRect(),
      );
      setHoverEdge((current) => (current === edge ? current : edge));
    },
    [draggingSessionId],
  );

  const handleDropCapture = useCallback(
    (event: React.DragEvent) => {
      if (!isSessionTabDrag(event, draggingSessionId)) return;
      event.preventDefault();
      event.stopPropagation();
      const dragged =
        event.dataTransfer.getData(SESSION_TAB_DRAG_MIME) ||
        draggingSessionId ||
        "";
      const root = rootRef.current;
      const edge = root
        ? resolveSessionSplitEdge(event.clientX, event.clientY, root.getBoundingClientRect())
        : hoverEdge;
      setHoverEdge(null);
      if (!dragged || !edge) return;
      onDropSplit(dragged, edge);
    },
    [draggingSessionId, hoverEdge, onDropSplit],
  );

  const showPreview = Boolean(draggingSessionId && hoverEdge);

  return (
    <div
      ref={rootRef}
      className="session-split-stage relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      onDragOverCapture={handleDragOverCapture}
      onDropCapture={handleDropCapture}
      onDragLeave={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) clearHover();
      }}
    >
      {layout ? (
        <ResizablePanelGroup
          orientation={layout.orientation}
          className="session-split-group h-full min-h-0 flex-1"
        >
          <ResizablePanel
            id="session-split-first"
            minSize={24}
            defaultSize={50}
            className="session-split-panel min-h-0 min-w-0"
          >
            {first}
          </ResizablePanel>
          <ResizableHandle withHandle className="session-split-sash" />
          <ResizablePanel
            id="session-split-second"
            minSize={24}
            defaultSize={50}
            className="session-split-panel min-h-0 min-w-0"
          >
            {second}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="session-split-solo flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {solo}
        </div>
      )}

      {showPreview && hoverEdge ? (
        <div
          className={`session-split-drop-preview session-split-drop-preview-${hoverEdge}`}
          aria-hidden="true"
        >
          <span className="session-split-drop-label">
            {t(`session.split.preview.${hoverEdge}`)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
