import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FileTreeNode } from "../../../../shared/types";
import { t } from "../../i18n";
import type { SuggestionItem } from "../app/AppUtils";
import { IconButton } from "../ui/IconButton";
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
				<IconButton
					className="command-palette-close"
					label={t("common.close")}
					onClick={props.onClose}
				>
					<X size={16} strokeWidth={2.2} aria-hidden="true" />
				</IconButton>
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
}) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [pos, setPos] = useState({ x: props.menu.x, y: props.menu.y });
	const isFile = props.menu.node.type === "file";
	const isDir = props.menu.node.type === "directory";

	// 测量菜单实际高度，超底部时向上翻转，避免底部文件右键菜单被视口遮挡。
	// 翻转后至少保留 8px 上边距，使菜单始终可读。
	useEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const overflowY = rect.bottom - window.innerHeight;
		if (overflowY > 0) {
			setPos({ x: props.menu.x, y: Math.max(8, props.menu.y - rect.height) });
		}
	}, [props.menu.x, props.menu.y]);

	return (
		<div className="context-backdrop" onClick={props.onClose}>
			<div
				ref={menuRef}
				className="context-menu"
				style={{ left: pos.x, top: pos.y }}
				onClick={(event) => event.stopPropagation()}
			>
				<button disabled={!isFile} onClick={props.onAttach}>
					{t("menu.attachFile")}
				</button>
				<button disabled={!isFile} onClick={props.onOpen}>
					{t("menu.defaultOpen")}
				</button>
				<button onClick={props.onReveal}>{t("menu.revealFile")}</button>
				<button onClick={props.onCopyPath}>{t("menu.copyPath")}</button>
				{props.onRename && (
					<button onClick={props.onRename}>{t("common.rename")}</button>
				)}
				{props.onDelete && (
					<button className="danger" onClick={props.onDelete}>
						{t("common.delete")}
					</button>
				)}
			</div>
		</div>
	);
}
