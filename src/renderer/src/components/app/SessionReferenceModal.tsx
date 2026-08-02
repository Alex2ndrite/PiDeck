	import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Brain, FileText, X } from "lucide-react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";
import { t } from "../../i18n";
import type { SessionSummary } from "../../../../shared/types";
import { summarizeMessage, stripAnsi, formatTime } from "./AppUtils";
import { Checkbox } from "../ui-shadcn/checkbox";

type SessionMessage = { role: string; content: string; timestamp: number };

export type SessionReferenceResult = {
	sessionName: string;
	messages: SessionMessage[];
	fullContext: boolean;
};

export function SessionReferenceModal(props: {
	session: SessionSummary;
	onClose: () => void;
	onConfirm: (result: SessionReferenceResult, selectedIndices: number[]) => void;
	loadMessages: (sessionId: string) => Promise<SessionMessage[]>;
	initialSelected?: Set<number>;
}) {
	// 原始顺序存储，selectedIds 始终引用原始索引
	const [messages, setMessages] = useState<SessionMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => props.initialSelected ?? new Set());

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		props.loadMessages(props.session.id).then((msgs) => {
			if (!cancelled) {
				setMessages(msgs);
				if (props.initialSelected && props.initialSelected.size > 0) {
					setSelectedIds(props.initialSelected);
				} else {
					setSelectedIds(new Set(msgs.map((_, i) => i)));
				}
				setLoading(false);
			}
		}).catch((err) => {
			if (!cancelled) { setError(String(err)); setLoading(false); }
		});
		return () => { cancelled = true; };
	}, [props.session.id]);

	// 倒序显示分组（最新的在前面），内部索引保持原始顺序不变
	const items = useMemo(() => {
		const result: Array<
			| { kind: "user"; index: number; msg: SessionMessage }
			| { kind: "assistant-run"; indices: number[]; msgs: SessionMessage[] }
		> = [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				// 收集连续的 assistant
				const runIndices: number[] = [];
				const runMsgs: SessionMessage[] = [];
				while (i >= 0 && messages[i].role === "assistant") {
					runIndices.unshift(i);
					runMsgs.unshift(messages[i]);
					i--;
				}
				i++; // 回退一个位置
				result.push({ kind: "assistant-run", indices: runIndices, msgs: runMsgs });
			} else if (msg.role === "user") {
				result.push({ kind: "user", index: i, msg });
			} else {
				result.push({ kind: "user", index: i, msg });
			}
		}
		return result;
	}, [messages]);

	const toggleMessage = useCallback((index: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			next.has(index) ? next.delete(index) : next.add(index);
			return next;
		});
	}, []);

	const toggleRun = useCallback((indices: number[]) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			const allSelected = indices.every((i) => next.has(i));
			for (const i of indices) {
				if (allSelected) next.delete(i);
				else next.add(i);
			}
			return next;
		});
	}, []);

	const toggleAll = useCallback(() => {
		setSelectedIds((prev) =>
			prev.size === messages.length ? new Set() : new Set(messages.map((_, i) => i))
		);
	}, [messages.length]);

	const handleConfirm = useCallback(() => {
		const indices = Array.from(selectedIds).sort((a, b) => a - b);
		const selected = indices.map((i) => messages[i]);
		props.onConfirm({
			sessionName: props.session.name ?? props.session.filePath,
			messages: selected,
			fullContext: selectedIds.size === messages.length,
		}, indices);
	}, [messages, selectedIds, props]);

	const selectedCount = selectedIds.size;
	const allSelected = selectedCount === messages.length;

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent
				showCloseButton={false}
				size="xl" className={cn("flex flex-col gap-0 overflow-hidden rounded-lg border border-border bg-bg-panel p-0 shadow-[var(--shadow-xl)] animate-in fade-in-0 slide-in-from-bottom-2 duration-150 session-ref-modal")}
			>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{`${t("sessionRef.title")}: ${props.session.name ?? props.session.filePath}`}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 [&>*]:my-0.5 session-ref-message-list">
					{loading && <div className="session-ref-loading">{t("common.loading")}...</div>}
					{error && <div className="session-ref-error">{t("sessionRef.loadError")}: {error}</div>}

					{!loading && !error && items.map((item) => {
						// 用户消息：独立行，完全对齐 MultiSelectModal user message
						if (item.kind === "user") {
							const isChecked = selectedIds.has(item.index);
							return (
								<label
									key={item.index}
									className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-[13px] leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover${isChecked ? " selected" : ""}`}
								>
									<Checkbox checked={isChecked} onChange={() => toggleMessage(item.index)} />
									<MessageCircle size={14} className="shrink-0 text-text-tertiary" />
									<span className="flex min-w-0 flex-1 items-baseline gap-2">
										<span className="min-w-0 truncate font-sans text-text-primary">
											{summarizeMessage(stripAnsi(item.msg.content))}
										</span>
									</span>
								</label>
							);
						}

						// 助理消息：agent-run 结构，完全对齐 MultiSelectModal agent-run
						if (item.kind === "assistant-run") {
							const runChecked = item.indices.every((i) => selectedIds.has(i));
							const runHasSome = item.indices.some((i) => selectedIds.has(i));
							const runAnyChecked = runChecked || runHasSome;

							return (
								<div key={item.indices[0]} className="my-1.5 overflow-hidden rounded-md border border-border-subtle bg-[color:color-mix(in_srgb,var(--color-bg-muted)_52%,transparent)]">
									<div
										className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-[13px] leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover run-parent cursor-pointer rounded-none border-0 border-b border-border-subtle bg-[color:color-mix(in_srgb,var(--color-bg-muted)_78%,var(--color-bg-panel))] p-2.5 font-medium select-none${runAnyChecked ? " selected" : ""}`}
										onClick={() => toggleRun(item.indices)}
									>
										<Brain size={15} className="shrink-0 text-text-tertiary" />
										<span className="flex min-w-0 flex-1 items-baseline gap-2">
											<span className="font-mono text-xs font-semibold tracking-[0.4px] uppercase text-text-secondary">pi</span>
											<span className="shrink-0 text-xs whitespace-nowrap text-text-tertiary">
												{formatTime(item.msgs[item.msgs.length - 1]?.timestamp ?? 0)}
											</span>
										</span>
										<span className="min-w-[18px] shrink-0 rounded-[10px] bg-bg-muted px-[7px] text-center font-mono text-[11px] leading-[18px] text-text-tertiary">
											{item.msgs.length}
										</span>
									</div>
									<div className="flex flex-col gap-0.5 bg-bg-panel p-1 pl-7">
										{item.msgs.map((sub, si) => {
											const idx = item.indices[si];
											const subChecked = selectedIds.has(idx);
											return (
												<label
													key={idx}
													className={`flex cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 py-[7px] text-[13px] leading-relaxed transition-[background,border-color] duration-100 hover:border-border-subtle hover:bg-bg-hover run-child rounded-sm p-1.5${subChecked ? " selected" : ""}`}
												>
													<Checkbox checked={subChecked} onChange={() => toggleMessage(idx)} />
													<FileText size={14} className="shrink-0 text-text-tertiary" />
													<span className="flex min-w-0 flex-1 items-baseline gap-2">
														<span className="min-w-0 truncate font-sans text-text-primary">
															{summarizeMessage(stripAnsi(sub.content))}
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

				<footer className="multi-select-modal-footer">
					<div className="multi-select-modal-footer-top">
						<span className="multi-select-count">
							{allSelected
								? t("sessionRef.messageCount", { count: messages.length })
								: t("sessionRef.selectedCount", { count: selectedCount, total: messages.length })}
						</span>
						<div className="multi-select-bulk-actions">
							<Button variant="ghost" size="sm" className="multi-select-bulk-btn h-auto px-2 py-0.5 text-xs" onClick={toggleAll} disabled={!messages.length}>
								{allSelected ? t("common.deselectAll") : t("common.selectAll")}
							</Button>
						</div>
					</div>
					<div className="multi-select-modal-footer-bottom">
						<Button
							variant="outline" size="sm" className="multi-select-action-btn h-auto px-4 py-1.5 text-xs shadow-none rounded-[6px]"
							disabled={loading || !!error || selectedCount === 0}
							onClick={handleConfirm}
						>
							{allSelected
								? t("sessionRef.insertAll", { count: messages.length })
								: t("sessionRef.insertSelected", { count: selectedCount })}
						</Button>
					</div>
				</footer>
				</DialogContent>
		</Dialog>
	);
}
