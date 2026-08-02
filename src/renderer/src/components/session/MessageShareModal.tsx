import { useCallback, useMemo, useState } from "react";
import { Brain, Check, FileText, MessageCircle, X } from "lucide-react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";
import type { AgentRunItem, MessageItem, RenderMessage } from "../app/AppUtils";
import { summarizeMessage } from "../app/AppUtils";
import { t } from "../../i18n";
import { formatTime, stripAnsi } from "./TimelineFormat";
import { Checkbox } from "../ui-shadcn/checkbox";

function getSelectableMessageIds(
	items: RenderMessage[],
): string[] {
	const ids: string[] = [];
	for (const item of items) {
		if (item.kind === "message" &&
			(item.message.role === "user" || item.message.role === "assistant")) {
			ids.push(item.message.id);
		} else if (item.kind === "agent-run") {
			for (const sub of item.items) {
				if (sub.kind === "message" && sub.message.role === "assistant") {
					ids.push(sub.message.id);
				}
			}
		}
	}
	return ids;
}

/**
 * 多选分享弹框：以会话树形式展示消息，用户勾选后复制分享。
 * 支持按 agent-run 层级全选或逐条选择。
 */
export function MultiSelectModal(props: {
	renderedRuns: RenderMessage[];
	onClose: () => void;
	onCopy: (
		selectedIds: Set<string>,
		kind: "text" | "markdown" | "image",
	) => void;
}) {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(
		() => new Set(getSelectableMessageIds(props.renderedRuns)),
	);
	const [copying, setCopying] = useState<
		"text" | "markdown" | "image" | null
	>(null);

	const allSelectableIds = useMemo(
		() => getSelectableMessageIds(props.renderedRuns),
		[props.renderedRuns],
	);

	const toggleMessage = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const isRunFullySelected = useCallback(
		(run: AgentRunItem) => {
			const ids = run.items
				.filter(
					(i): i is MessageItem =>
						i.kind === "message" && i.message.role === "assistant",
				)
				.map((i) => i.message.id);
			return ids.length > 0 && ids.every((id) => selectedIds.has(id));
		},
		[selectedIds],
	);

	const toggleRun = useCallback(
		(run: AgentRunItem) => {
			const ids = run.items
				.filter(
					(i): i is MessageItem =>
						i.kind === "message" && i.message.role === "assistant",
				)
				.map((i) => i.message.id);
			if (ids.length === 0) return;
			const allSelected = ids.every((id) => selectedIds.has(id));
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) {
					if (allSelected) next.delete(id);
					else next.add(id);
				}
				return next;
			});
		},
		[selectedIds],
	);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(allSelectableIds));
	}, [allSelectableIds]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	/** 点击分享按钮：先显示脉冲动画，再执行复制关闭弹框 */
	const handleCopy = useCallback(
		async (kind: "text" | "markdown" | "image") => {
			setCopying(kind);
			// 让按钮脉冲动画渲染一帧后再执行复制
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
			setCopying(null);
			props.onCopy(selectedIds, kind);
		},
		[selectedIds, props.onCopy],
	);

	const selectedCount = selectedIds.size;
	const totalCount = allSelectableIds.length;

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent
				showCloseButton={false}
				className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(800px,calc(100vw-48px))]", "h-[min(850px,calc(100vh-48px))] w-[min(1300px,calc(100vw-48px))] max-w-[min(1300px,calc(100vw-48px))] flex flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-[var(--shadow-xl)] animate-in fade-in-0 slide-in-from-bottom-2 duration-150")}
			>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("app.multiSelectEnter")}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				{/* 树状列表 */}
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 [&>*]:my-0.5">
					{props.renderedRuns.map((item) => {
						if (item.kind === "message") {
							const msg = item.message;
							if (msg.role === "user" || msg.role === "assistant") {
								const isChecked = selectedIds.has(msg.id);
								return (
									<label
										key={msg.id}
										className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-control leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover${isChecked ? " selected" : ""}`}
									>
										<Checkbox
											checked={isChecked}
											onChange={() => toggleMessage(msg.id)}
											className="m-0 shrink-0 cursor-pointer accent-[var(--color-accent)]"
										/>
										<MessageCircle
											size={14}
											className="shrink-0 text-text-tertiary"
										/>
										<span className="flex min-w-0 flex-1 items-baseline gap-2">
											<span className="min-w-0 truncate font-sans text-text-primary">
												{summarizeMessage(stripAnsi(msg.text))}
											</span>
										</span>
									</label>
								);
							}
							return null;
						}

						if (item.kind === "agent-run") {
							const runChecked = isRunFullySelected(item);
							const runHasSome = item.items.some(
								(i) =>
									i.kind === "message" &&
									i.message.role === "assistant" &&
									selectedIds.has(i.message.id),
							);
							const runAnyChecked = runChecked || runHasSome;
							const assistantMsgs = item.items.filter(
								(i): i is MessageItem =>
									i.kind === "message" && i.message.role === "assistant",
							);
							if (assistantMsgs.length === 0) return null;

							return (
								<div key={item.id} className="my-1.5 overflow-hidden rounded-md border border-border-subtle bg-[color:color-mix(in_srgb,var(--color-bg-muted)_52%,transparent)]">
									<div
										className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-control leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover run-parent cursor-pointer rounded-none border-0 border-b border-border-subtle bg-[color:color-mix(in_srgb,var(--color-bg-muted)_78%,var(--color-bg-panel))] p-2.5 font-medium select-none${runAnyChecked ? " selected" : ""}`}
										onClick={() => toggleRun(item)}
									>
										<Brain size={15} className="shrink-0 text-text-tertiary" />
										<span className="flex min-w-0 flex-1 items-baseline gap-2">
											<span className="font-mono text-caption font-semibold tracking-[0.4px] uppercase text-text-secondary">pi</span>
											<span className="shrink-0 text-caption whitespace-nowrap text-text-tertiary">
												{formatTime(item.endedAt)}
											</span>
										</span>
										<span className="min-w-[18px] shrink-0 rounded-[10px] bg-bg-muted px-[7px] text-center font-mono text-micro leading-[18px] text-text-tertiary">
											{assistantMsgs.length}
										</span>
									</div>
									<div className="flex flex-col gap-0.5 bg-bg-panel p-1 pl-7">
										{assistantMsgs.map((sub) => {
											const subChecked = selectedIds.has(sub.message.id);
											return (
												<label
													key={sub.message.id}
													className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-control leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover run-child rounded-sm p-1.5${subChecked ? " selected" : ""}`}
												>
													<Checkbox
														checked={subChecked}
														onChange={() =>
															toggleMessage(sub.message.id)
														}
														className="m-0 shrink-0 cursor-pointer accent-[var(--color-accent)]"
													/>
													<FileText
														size={14}
														className="shrink-0 text-text-tertiary"
													/>
													<span className="flex min-w-0 flex-1 items-baseline gap-2">
														<span className="min-w-0 truncate font-sans text-text-primary">
															{summarizeMessage(
																stripAnsi(sub.message.text),
															)}
														</span>
													</span>
												</label>
											);
										})}
									</div>
								</div>
							);
						}

						return null;
					})}
				</div>

				{/* 底部操作栏 */}
				<footer className="multi-select-modal-footer">
					<div className="multi-select-modal-footer-top">
						<span className="multi-select-count">
							{t("app.multiSelectCount", { count: selectedCount })}
						</span>
						<div className="multi-select-bulk-actions">
							<Button
								variant="ghost"
								size="sm"
								className="multi-select-bulk-btn h-auto px-2 py-0.5 text-caption"
								onClick={selectAll}
								disabled={!totalCount}
							>
								{t("common.selectAll")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="multi-select-bulk-btn h-auto px-2 py-0.5 text-caption"
								onClick={deselectAll}
								disabled={!selectedCount}
							>
								{t("common.deselectAll")}
							</Button>
						</div>
					</div>
					<div className="multi-select-modal-footer-bottom">
						<Button
							variant="outline"
							size="sm"
							className={`multi-select-action-btn${copying === "text" ? " copying" : ""} h-auto px-4 py-1.5 text-caption shadow-none rounded-[6px]`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("text")}
						>
							{copying === "text" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsText")
							)}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className={`multi-select-action-btn${copying === "markdown" ? " copying" : ""} h-auto px-4 py-1.5 text-caption shadow-none rounded-[6px]`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("markdown")}
						>
							{copying === "markdown" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsMarkdown")
							)}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className={`multi-select-action-btn${copying === "image" ? " copying" : ""} h-auto px-4 py-1.5 text-caption shadow-none rounded-[6px]`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("image")}
						>
							{copying === "image" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsImage")
							)}
						</Button>
						<Button
							variant="default"
							size="sm"
							className="multi-select-action-btn primary h-auto px-4 py-1.5 text-caption shadow-none rounded-[6px]"
							onClick={props.onClose}
							disabled={!!copying}
						>
							{t("app.multiSelectCancel")}
						</Button>
					</div>
				</footer>
			</DialogContent>
		</Dialog>
	);
}
