/**
 * WebHeader — Web 端会话头部（与桌面 SessionHeader 同布局）。
 *
 * 左侧：会话标题（截断）；右侧：运行态指示 + 流式中「停止响应」按钮。
 * 运行态来自 useChat status（submitted/streaming）与轮询的 runtime.status 兜底。
 */
import { Button } from "@/components/ui-shadcn/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type WebHeaderStatus = "idle" | "starting" | "running" | "error";

export function WebHeader(props: {
	title: string;
	status: WebHeaderStatus;
	streaming: boolean;
	canStop: boolean;
	onStop: () => void;
}) {
	const { title, status, streaming, canStop, onStop } = props;
	return (
		<header className="chat-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-4 py-2.5">
			<div className="chat-title-block flex min-w-0 flex-1 items-center">
				<div className="chat-title-row flex h-8 w-full min-w-0 items-center gap-2">
					<strong
						className="block min-w-0 flex-1 truncate text-title font-semibold tracking-tight text-foreground"
						title={title}
					>
						{title}
					</strong>
				</div>
			</div>
			<div className="chat-header-actions flex min-w-0 items-center justify-end gap-2">
				{/* 运行态指示：复用桌面 agent-status-indicator 视觉 */}
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"agent-status-indicator",
							status === "running" && "status-running",
							status === "starting" && "status-starting",
							status === "error" && "status-error",
							status === "idle" && "status-idle",
						)}
					>
						{t(statusLabelKey(status))}
					</span>
				</span>
				{streaming && canStop && (
					<Button
						type="button"
						variant="destructive"
						size="sm"
						className="h-8 gap-1 px-2.5"
						onClick={onStop}
					>
						{t("app.stop")}
					</Button>
				)}
			</div>
		</header>
	);
}

function statusLabelKey(status: WebHeaderStatus) {
	switch (status) {
		case "running":
			return "app.statusRunning" as const;
		case "starting":
			return "app.statusStarting" as const;
		case "error":
			return "app.statusError" as const;
		default:
			return "app.statusIdle" as const;
	}
}
