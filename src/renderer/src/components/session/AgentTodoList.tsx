import { useMemo, useState } from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
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
 * BEUI Todo List 风格的 Agent 计划列表。
 * 组件只读消费 widget 快照，完成状态由 pi 扩展维护，避免 renderer 与 Agent 状态分叉。
 */
export function AgentTodoList(props: {
	items: AgentTodoItem[];
	title: string;
	defaultOpen?: boolean;
	collapseOnComplete?: boolean;
	maxHeight?: number;
	className?: string;
}) {
	const [open, setOpen] = useState(props.defaultOpen ?? true);
	const completed = props.items.filter((item) => item.status === "completed").length;
	const shouldCollapse = props.collapseOnComplete !== false && props.items.length > 0 && completed === props.items.length;
	const visible = useMemo(
		() => props.items.filter((item) => !shouldCollapse || item.status !== "completed"),
		[props.items, shouldCollapse],
	);
	if (props.items.length === 0) return null;

	return (
		<section className={cn("overflow-hidden rounded-md border border-border-subtle bg-bg-panel", props.className)}>
			<button
				type="button"
				className="flex min-h-8 w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg-hover"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
			>
				<span className={cn("text-micro transition-transform", open && "rotate-90")} aria-hidden="true">›</span>
				<span className="flex-1 text-caption font-semibold text-text-primary">{props.title}</span>
				<span className="tabular-nums text-micro text-text-tertiary">{completed}/{props.items.length}</span>
			</button>
			{open ? (
				<div className="border-t border-border-subtle p-1.5" style={{ maxHeight: props.maxHeight ?? 248, overflowY: "auto" }}>
					<div className="flex flex-col gap-0.5">
						{visible.map((item) => (
							<div key={item.id} className="flex min-w-0 items-start gap-2 rounded-sm px-1.5 py-1 text-caption hover:bg-bg-hover">
								<TodoStatusIcon status={item.status} />
								<span className={cn("min-w-0 flex-1 break-words", item.status === "completed" ? "text-text-tertiary line-through" : "text-text-primary")}>
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
	if (status === "completed") return <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-success)]" aria-hidden="true" />;
	if (status === "in-progress") return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--color-accent)]" aria-hidden="true" />;
	return <Circle className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />;
}
