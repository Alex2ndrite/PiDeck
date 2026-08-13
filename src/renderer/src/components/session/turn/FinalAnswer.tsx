import { memo, type RefObject } from "react";
import type { ChatMessage, ImageContent } from "../../../../../shared/types";
import type { ImageGenMeta } from "../../../../../shared/types/imagegen";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Textarea } from "../../ui-shadcn/textarea";
import { ImageGeneration } from "../../agents/image-generation";
import { AssistantText } from "../SurfaceComponents";

/** 收窄 meta.imageGen（消息数据来自历史会话/缓存，需运行时校验而非盲转）。 */
function isImageGenMeta(value: unknown): value is ImageGenMeta {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		(v.status === "generating" || v.status === "complete" || v.status === "error") &&
		typeof v.prompt === "string"
	);
}

/**
 * 生图消息渲染：随 meta.imageGen.status 在「生成中点阵动画 → 图片清晰过渡 → 失败态」间切换。
 * 复用 beUI ImageGeneration（canvas 点阵 + motion 过渡），完成态图片支持点击放大预览。
 */
function ImageGenMessage(props: {
	meta: ImageGenMeta;
	images?: ImageContent[];
	onPreviewImage: (image: ImageContent) => void;
}) {
	const status = props.meta.status;
	const statusText =
		status === "generating"
			? t("imagegen.status.generating")
			: status === "complete"
				? t("imagegen.status.complete")
				: t("imagegen.status.error");
	const image = props.images?.[0];
	return (
		<div className="py-1">
			<ImageGeneration
				status={status}
				prompt={props.meta.prompt}
				statusText={statusText}
				resolution={undefined}
				size="fluid"
				className="max-w-[300px]"
			>
				{status === "complete" && image ? (
					<img
						src={`data:${image.mimeType};base64,${image.data}`}
						alt=""
						className="cursor-zoom-in"
						onClick={() => props.onPreviewImage(image)}
					/>
				) : undefined}
			</ImageGeneration>
			{status === "error" && props.meta.errorDetail ? (
				<p className="mt-1.5 text-xs text-destructive">{props.meta.errorDetail}</p>
			) : null}
		</div>
	);
}

/**
 * 最终回答段：本轮最后一条 assistant 文本，常驻、永不折叠。
 * 承载原地编辑 UI（编辑入口在 run 操作栏，编辑表单内联在此）。
 */
export const FinalAnswer = memo(function FinalAnswer(props: {
	message: ChatMessage;
	images?: ImageContent[];
	isStreaming?: boolean;
	/** live→settled 交接淡入 */
	settle?: boolean;
	/** 编辑态 */
	editing: boolean;
	editText: string;
	editAreaRef: RefObject<HTMLDivElement | null>;
	onEditTextChange: (text: string) => void;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onSaveEdit: () => void;
	onPreviewImage: (image: ImageContent) => void;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	if (props.editing) {
		return (
			<div
				className="flex flex-col gap-2 rounded-md border border-border-subtle bg-[color:color-mix(in_srgb,var(--color-accent)_3%,var(--color-bg-panel))] pl-2"
				ref={props.editAreaRef}
			>
				<div className="flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] before:content-['✎'] before:text-sm">
					{t("common.edit")}
				</div>
				<Textarea
					className="min-h-[100px] max-h-[400px] w-full resize-y rounded-sm border border-[var(--color-accent)] bg-bg-panel p-2 font-mono text-sm leading-relaxed text-text-primary outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--focus-ring)]"
					value={props.editText}
					onChange={(e) => props.onEditTextChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							props.onSaveEdit();
						}
						if (e.key === "Escape") props.onCancelEdit();
					}}
					autoFocus
				/>
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-auto border-[var(--color-accent)] px-3 py-1 text-xs text-[var(--color-accent)] shadow-none hover:text-[var(--color-accent)]"
						onClick={props.onSaveEdit}
					>
						{t("common.save")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-auto px-3 py-1 text-xs shadow-none"
						onClick={props.onCancelEdit}
					>
						{t("common.cancel")}
					</Button>
				</div>
			</div>
		);
	}
	// 生图消息：不渲染 markdown 正文，改渲染 beUI ImageGeneration（点阵动画→图片→失败态）。
	const imageGenMeta = isImageGenMeta(props.message.meta?.imageGen)
		? props.message.meta.imageGen
		: undefined;
	if (imageGenMeta) {
		return (
			<ImageGenMessage
				meta={imageGenMeta}
				images={props.images}
				onPreviewImage={props.onPreviewImage}
			/>
		);
	}
	return (
		<AssistantText
			text={props.message.text}
			images={props.images}
			onPreviewImage={props.onPreviewImage}
			onOpenExternal={props.onOpenExternal}
			onOpenFile={props.onOpenFile}
			isStreaming={props.isStreaming ?? false}
			settle={props.settle}
		/>
	);
});
