import { useCallback, useRef, useState, type ReactNode } from "react";
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
  /** 单栏时的宿主会话（用于 drop 计算） */
  hostSessionId: string | undefined;
  onDropSplit: (draggedSessionId: string, edge: SessionSplitEdge) => void;
  /** 单栏内容；分屏时忽略 */
  solo: ReactNode;
  /** 分屏左/上 */
  first: ReactNode;
  /** 分屏右/下 */
  second: ReactNode;
};

/**
 * 会话区分屏舞台：边缘落点预览 + 双栏可拖拽分隔。
 * 只负责几何与呈现；分屏策略由 onDropSplit（workspace chrome）决定。
 */
export function SessionSplitStage(props: SessionSplitStageProps) {
  const {
    layout,
    draggingSessionId,
    hostSessionId,
    onDropSplit,
    solo,
    first,
    second,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hoverEdge, setHoverEdge] = useState<SessionSplitEdge | null>(null);

  const clearHover = useCallback(() => setHoverEdge(null), []);

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!draggingSessionId) return;
      const root = rootRef.current;
      if (!root) return;
      event.preventDefault();
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

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
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
      if (!layout && dragged === hostSessionId) return;
      onDropSplit(dragged, edge);
    },
    [draggingSessionId, hostSessionId, hoverEdge, layout, onDropSplit],
  );

  const showPreview = Boolean(draggingSessionId && hoverEdge);

  return (
    <div
      ref={rootRef}
      className="session-split-stage relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) clearHover();
      }}
      onDrop={handleDrop}
      onDragEnd={clearHover}
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
