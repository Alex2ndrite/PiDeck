import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FileTreeNode } from "../../../../shared/types";
import { t } from "../../i18n";
import type { SuggestionItem } from "../app/AppUtils";
import { Button } from "../ui-shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui-shadcn/dropdown-menu";
export function PromptSuggestions(props: {
	prompt: string;
	items: SuggestionItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	onClose: () => void;
	onPick: (value: string) => void;
	/** 菜单锚定位置（屏幕坐标），未传则使用默认居中定位 */
	anchorStyle?: React.CSSProperties;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	// 头部标题类型由选中项推导:光标相关触发后,第一个候选的 value 前缀即代表当前是命令还是文件。
	const isCommand = props.items[0]?.value.startsWith("/") ?? false;
	const isSession = props.items[0]?.value.startsWith("&") ?? false;
	const headerLabel = isCommand ? t("prompt.commands") : isSession ? t("prompt.sessions") : t("prompt.files");

	// 滚动到选中项
	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const item = list.children[props.selectedIndex] as HTMLElement;
		if (item) {
			item.scrollIntoView({ block: "nearest" });
		}
	}, [props.selectedIndex]);

	if (props.items.length === 0) return null;

	// 阻止 mousedown 冒泡到 RichInput，避免点击面板时触发 blur 关闭面板，
	// 但保留各按钮的 onClick 正常工作。
	return (
		<div
			className="command-palette"
			style={props.anchorStyle}
			onMouseDown={(e) => e.preventDefault()}
		>
			<div className="command-palette-header">
				<span>{headerLabel}</span>
				<Button variant="ghost" size="icon"
					className="command-palette-close"
					aria-label={t("common.close")} title={t("common.close")}
					onClick={props.onClose}
				>
					<X size={16} strokeWidth={2.2} aria-hidden="true" />
				</Button>
			</div>
			<div className="command-palette-list" ref={listRef}>
				{props.items.map((item, index) => (
					<button
						key={item.key}
						className={`command-palette-item${index === props.selectedIndex ? " selected" : ""}`}
						onMouseEnter={() => props.onSelectedIndexChange(index)}
						onClick={() => props.onPick(item.value)}
					>
						<span className="command-palette-label">{item.label}</span>
						<span className="command-palette-desc">{item.description}</span>
					</button>
				))}
			</div>
			<div className="command-palette-footer">
				<span>{t("prompt.selectHint")}</span>
				<span>{t("prompt.confirmHint")}</span>
				<span>{t("prompt.closeHint")}</span>
			</div>
		</div>
	);
}

export function FileContextMenu(props: {
	menu: { x: number; y: number; node: FileTreeNode };
	onClose: () => void;
	onOpen: () => void;
	onReveal: () => void;
	onAttach: () => void;
	onCopyPath: () => void;
	onDelete?: () => void;
	onRename?: () => void;
	/** 剪贴板中有文件路径时显示「粘贴」选项 */
	hasClipboardFiles?: boolean;
	onPaste?: (targetDir: string) => void;
}) {
	const isFile = props.menu.node.type === "file";
	const targetDir = props.menu.node.type === "directory"
		? props.menu.node.path
		: props.menu.node.path.split(/[\\/]/).slice(0, -1).join("/") || ".";

	// #115 U5：右键菜单换 Radix DropdownMenu。虚拟锚点把菜单钉在右键坐标上，
	// 视口碰撞翻转/焦点圈定/ESC 关闭全由 Radix 负责，删掉手写的测高翻转与遮罩。
	return (
		<DropdownMenu open onOpenChange={(open) => { if (!open) props.onClose(); }}>
			{/* 不可见 Trigger 钉在右键坐标上：Radix dropdown-menu 没有 Anchor 部件，
			    受控 open 下仍按 Trigger 矩形定位，这是官方推荐的坐标菜单模式。 */}
			<DropdownMenuTrigger
				aria-hidden
				tabIndex={-1}
				style={{
					position: "fixed",
					left: props.menu.x,
					top: props.menu.y,
					width: 0,
					height: 0,
					padding: 0,
					border: 0,
					background: "transparent",
					pointerEvents: "none",
				}}
			/>
			<DropdownMenuContent align="start" side="bottom" className="min-w-40">
				<DropdownMenuItem disabled={!isFile} onSelect={props.onAttach}>
					{t("menu.attachFile")}
				</DropdownMenuItem>
				<DropdownMenuItem disabled={!isFile} onSelect={props.onOpen}>
					{t("menu.defaultOpen")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={props.onReveal}>{t("menu.revealFile")}</DropdownMenuItem>
				<DropdownMenuItem onSelect={props.onCopyPath}>{t("menu.copyPath")}</DropdownMenuItem>
				{props.hasClipboardFiles && props.onPaste && (
					<DropdownMenuItem onSelect={() => props.onPaste?.(targetDir)}>
						{t("drawer.pasteFiles")}
					</DropdownMenuItem>
				)}
				{(props.onRename || props.onDelete) && <DropdownMenuSeparator />}
				{props.onRename && (
					<DropdownMenuItem onSelect={props.onRename}>{t("common.rename")}</DropdownMenuItem>
				)}
				{props.onDelete && (
					<DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
						{t("common.delete")}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
