/**
 * WebHeader — Web 端会话头部（与桌面 SessionHeader 同布局）。
 *
 * 左侧：会话标题（截断）；右侧：运行态指示 + 流式中「停止响应」按钮。
 * 运行态来自 useChat status（submitted/streaming）与轮询的 runtime.status 兜底。
 */
import type { AvailableModel } from "../../../shared/types";
import { Button } from "@/components/ui-shadcn/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui-shadcn/select";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type WebHeaderStatus = "idle" | "starting" | "running" | "error";

export function WebHeader(props: {
	title: string;
	status: WebHeaderStatus;
	streaming: boolean;
	canStop: boolean;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
	models: AvailableModel[];
	onModelChange: (model: AvailableModel) => void;
	onThinkingChange: (level: string) => void;
	onStop: () => void;
}) {
	const {
		title,
		status,
		streaming,
		canStop,
		model,
		thinkingLevel,
		models,
		onModelChange,
		onThinkingChange,
		onStop,
	} = props;
	// 与桌面 SessionHeader 同款矮顶栏，给消息区多留垂直空间
	return (
		<header className="chat-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-background px-3 py-1">
			<div className="chat-title-block flex min-w-0 flex-1 items-center">
				<div className="chat-title-row flex h-7 w-full min-w-0 items-center gap-1.5">
					<strong
						className="block min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground"
						title={title}
					>
						{title}
					</strong>
				</div>
			</div>
			<div className="chat-header-actions flex min-w-0 items-center justify-end gap-1.5">
				<Select
					value={model ? `${model.provider}::${model.modelId}` : undefined}
					onValueChange={(value) => {
						const next = models.find((item) => `${item.provider}::${item.id}` === value);
						if (next) onModelChange(next);
					}}
				>
					<SelectTrigger
						size="sm"
						className="max-w-52 border-transparent bg-transparent px-2 text-caption text-muted-foreground hover:bg-muted/60"
						aria-label={t("web.model")}
						title={model ? `${model.provider}/${model.modelId}` : t("web.model")}
					>
						<SelectValue placeholder={model ? `${model.provider}/${model.modelId}` : t("web.model")} />
					</SelectTrigger>
					<SelectContent>
						{models.map((item) => (
							<SelectItem key={`${item.provider}::${item.id}`} value={`${item.provider}::${item.id}`}>
								{item.provider}/{item.name || item.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select
					value={thinkingLevel ?? "off"}
					onValueChange={onThinkingChange}
				>
					<SelectTrigger
						size="sm"
						className="w-24 border-transparent bg-transparent px-2 text-caption text-muted-foreground hover:bg-muted/60"
						aria-label={t("web.thinking")}
						title={t("web.thinking")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{thinkingLevels.map((level) => (
							<SelectItem key={level} value={level}>{thinkingLabel(level)}</SelectItem>
						))}
					</SelectContent>
				</Select>
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

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function thinkingLabel(level: string) {
	switch (level) {
		case "minimal": return t("thinking.levelLabel.minimal");
		case "low": return t("thinking.levelLabel.low");
		case "medium": return t("thinking.levelLabel.medium");
		case "high": return t("thinking.levelLabel.high");
		case "xhigh": return t("thinking.levelLabel.xhigh");
		case "max": return t("thinking.levelLabel.max");
		default: return t("thinking.levelLabel.off");
	}
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
