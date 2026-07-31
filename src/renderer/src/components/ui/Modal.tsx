import type { ReactNode } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { cn } from "../../lib/utils";
import { CloseIconButton } from "./IconButton";
import { t } from "../../i18n";

/**
 * 共享弹框（#115 U5）：API 不变，内部换到 shadcn Dialog。
 * 尺寸规范沿用 AGENTS.md 约定（full/medium/small 三档），
 * 布局语义对齐旧实现：flex column + overflow hidden，padding 由内容区自管。
 */
export type ModalSize = "full" | "medium" | "small";

export interface ModalProps {
	/** 是否显示弹框 */
	open: boolean;
	/** 关闭弹框回调 */
	onClose: () => void;
	/** 弹框标题（可选）。传 title 时自动展示 header 区域 */
	title?: string;
	/** 弹框尺寸，对应预设的宽高 */
	size?: ModalSize;
	/** 主体内容 */
	children: ReactNode;
	/** header 右侧附加动作区（导出/导入等），渲染在关闭按钮左侧 */
	headerActions?: ReactNode;
	/** 额外的根元素 class（保留参数，当前不再使用） */
	className?: string;
	/** 额外的 content wrapper class */
	contentClassName?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
	full: "sm:max-w-[min(1300px,calc(100vw-48px))] h-[min(850px,calc(100vh-48px))]",
	medium: "sm:max-w-[min(800px,calc(100vw-48px))]",
	small: "sm:max-w-[min(480px,calc(100vw-48px))]",
};

export function Modal({
	open,
	onClose,
	title,
	size = "full",
	children,
	headerActions,
	contentClassName,
}: ModalProps) {
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				showCloseButton={false}
				className={cn("flex flex-col gap-0 overflow-hidden p-0", SIZE_CLASS[size], contentClassName)}
			>
				{title && (
					<DialogHeader className="flex-row items-center justify-between px-4 py-3">
						<DialogTitle>{title}</DialogTitle>
						<div className="flex items-center gap-2">
							{headerActions}
							<DialogClose asChild>
								<CloseIconButton label={t("common.close")} />
							</DialogClose>
						</div>
					</DialogHeader>
				)}
				{children}
			</DialogContent>
		</Dialog>
	);
}
