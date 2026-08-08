import { useEffect, useRef, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../ui-shadcn/resizable";
import type {
	WorkspaceContentOpenMode,
	WorkspaceSplitOrientation,
} from "../../../../shared/types";

export type WorkbenchStageProps = {
	/** 无内容时只渲染 session；有内容时按 layout 分屏或占满中间栏 */
	layout: WorkspaceContentOpenMode;
	orientation: WorkspaceSplitOrientation;
	hasContent: boolean;
	session: ReactNode;
	content: ReactNode | null;
};

/**
 * 中间栏工作台：会话与文件/Diff 内容宿主。
 *
 * - 无内容：会话独占（与改版前一致）
 * - split：可拖拽分屏（左右 / 上下）
 * - maximize：内容占满中间栏；会话面板 collapse(0) 但保持挂载，避免丢滚动/流式状态
 *
 * 浏览器仍在右侧抽屉，不进入本宿主。
 */
export function WorkbenchStage(props: WorkbenchStageProps) {
	const sessionPanelRef = useRef<PanelImperativeHandle>(null);

	useEffect(() => {
		if (!props.hasContent) return;
		const panel = sessionPanelRef.current;
		if (!panel) return;
		try {
			if (props.layout === "maximize") panel.collapse();
			else panel.expand();
		} catch {
			// 面板尚未注册到 Group 时 resize API 可能抛错，下一帧布局会自愈
		}
	}, [props.hasContent, props.layout, props.orientation]);

	if (!props.hasContent || !props.content) {
		// 与分屏态同一套高度契约：chat-pane 是 flex 列，solo 自身吃满；
		// 子树可能是 Fragment（Tab + 空态），高度分配交给 .workbench-stage-solo CSS。
		return <div className="workbench-stage workbench-stage-solo">{props.session}</div>;
	}

	const orientation =
		props.orientation === "vertical" ? "vertical" : "horizontal";

	return (
		<ResizablePanelGroup
			orientation={orientation}
			className="workbench-stage workbench-stage-split"
		>
			<ResizablePanel
				id="workbench-session"
				panelRef={sessionPanelRef}
				collapsible
				collapsedSize={0}
				minSize={20}
				defaultSize={props.layout === "maximize" ? 0 : 48}
				className="workbench-session-pane"
			>
				{props.session}
			</ResizablePanel>
			<ResizableHandle withHandle className="workbench-stage-sash" />
			<ResizablePanel
				id="workbench-content"
				minSize={25}
				defaultSize={props.layout === "maximize" ? 100 : 52}
				className="workbench-content-pane"
			>
				<div
					className={
						orientation === "vertical"
							? "workbench-content-frame workbench-content-frame-vertical"
							: "workbench-content-frame workbench-content-frame-horizontal"
					}
				>
					{props.content}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
