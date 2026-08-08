import { useState } from "react";
import { CheckCircle2, ChevronUp, Circle, LoaderCircle, X } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";

type TodoStatus = "pending" | "in-progress" | "completed";

export type AgentTodoItem = {
	id: string;
	title: string;
	status: TodoStatus;
};

/** 将 pi 扩展的轻量 widget 行转换为稳定的 TodoList 数据模型。 */
export function parseAgentTodoItems(lines: readonly string[]): AgentTodoItem[] {
	return lines
		.map((line, index) => {
			const trimmed = line.trim();
			if (!trimmed || /^\d+\/\d+$/.test(trimmed)) return undefined;
			const completed = trimmed.startsWith("☑") || trimmed.startsWith("[x]") || trimmed.startsWith("[X]");
			const active = trimmed.startsWith("◐") || trimmed.startsWith("⏳");
			const title = trimmed
				.replace(/^(?:☑|☐|◐|⏳|\[[ xX]\])\s*/, "")
				.replace(/^\d+[.)]\s*/, "")
				.trim();
			if (!title) return undefined;
			return {
				id: `${index}:${title}`,
				title,
				status: completed ? "completed" : active ? "in-progress" : "pending",
			};
		})
		.filter((item): item is AgentTodoItem => Boolean(item));
}

/**
 * 参考 BEUI Todo List 信息层级的 Agent 计划列表。
 * 组件只读消费 widget 快照，完成状态由 pi 扩展维护，避免 renderer 与 Agent 状态分叉。
 */
export function AgentTodoList(props: {
	items: AgentTodoItem[];
	title: string;
	defaultOpen?: boolean;
	/** 保留旧调用方参数，完成态不再自动隐藏列表项，和参考图保持一致。 */
	collapseOnComplete?: boolean;
	maxHeight?: number;
	onDismiss?: () => void;
	className?: string;
}) {
	const [open, setOpen] = useState(props.defaultOpen ?? true);
	const completed = props.items.filter((item) => item.status === "completed").length;
	// 完成态仍显示完整计划；collapseOnComplete 只保留为兼容字段，避免旧 widget 调用方失效。
	const visible = props.items;
	if (props.items.length === 0) return null;

	return (
		<section className={cn("group overflow-hidden rounded-[20px] border border-border-subtle bg-bg-panel", props.className)}>
			<div className="flex min-h-14 items-center pr-3">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-bg-hover"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
				>
					<CheckCircle2
						className={cn("size-5 shrink-0", completed === props.items.length ? "text-[var(--color-success)]" : "text-text-tertiary")}
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 truncate text-base font-medium text-text-primary">{props.title}</span>
					<span className={cn("tabular-nums text-sm font-semibold", completed === props.items.length ? "text-[var(--color-success)]" : "text-text-tertiary")}>
						{completed}/{props.items.length}
					</span>
					<ChevronUp className={cn("size-4 shrink-0 text-text-tertiary transition-transform", !open && "rotate-180")} aria-hidden="true" />
				</button>
				{props.onDismiss ? (
					<button
						type="button"
						className="flex size-6 shrink-0 items-center justify-center rounded-full text-text-tertiary opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
						onClick={props.onDismiss}
						title={t("common.close")}
						aria-label={t("common.close")}
					>
						<X className="size-3.5" aria-hidden="true" />
					</button>
				) : null}
			</div>
			{open ? (
				<div className="px-5 pb-4" style={{ maxHeight: props.maxHeight ?? 320, overflowY: "auto" }}>
					<div className="flex flex-col gap-1">
						{visible.map((item) => (
							<div key={item.id} className="flex min-w-0 items-start gap-3 rounded-md px-1 py-1.5 text-sm hover:bg-bg-hover">
								<TodoStatusIcon status={item.status} />
								<span className={cn("min-w-0 flex-1 break-words leading-6", item.status === "completed" ? "text-text-tertiary line-through" : "text-text-primary")}>
									{item.title}
								</span>
							</div>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
	if (status === "completed") return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-text-tertiary" aria-hidden="true" />;
	if (status === "in-progress") return <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-[var(--color-accent)]" aria-hidden="true" />;
	return <Circle className="mt-0.5 size-5 shrink-0 text-text-tertiary" aria-hidden="true" />;
}
