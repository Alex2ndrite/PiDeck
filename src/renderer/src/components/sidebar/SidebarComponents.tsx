import { useState, useRef, useLayoutEffect, useEffect, useMemo, type ReactNode } from "react";
import { Check, CircleAlert, CircleDot, Folder, LoaderCircle, MessageCircle } from "lucide-react";
import { t } from "../../i18n";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui-shadcn/dropdown-menu";
import { Button } from "../ui-shadcn/button";
import type { SessionSource, SessionSummary, Project, AgentTab } from "../../../../shared/types";
import { Checkbox } from "../ui-shadcn/checkbox";
import { Input } from "../ui-shadcn/input";
import { Label } from "../../components/ui-shadcn/label";

export function SessionManagerModal(props: {
	sessions: SessionSummary[];
	onClose: () => void;
	onRename: (session: SessionSummary) => void;
	onExport: (session: SessionSummary) => void;
	onDelete: (sessions: SessionSummary[]) => void;
}) {
	const SOURCES = ["pi", "codex", "claude", "opencode"] as const;
	const [activeSources, setActiveSources] = useState<Set<string>>(new Set(SOURCES));
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [selectAll, setSelectAll] = useState(false);

	// 按来源过滤
	const filteredSessions = props.sessions.filter((s) =>
		activeSources.has(s.source ?? "pi"),
	);

	const toggleSource = (source: string) => {
		setActiveSources((prev) => {
			const next = new Set(prev);
			if (next.has(source)) {
				next.delete(source);
			} else {
				next.add(source);
			}
			return next;
		});
		setSelected(new Set());
		setSelectAll(false);
	};

	// 全选/取消全选（只在当前过滤后的范围内）
	const handleToggleAll = () => {
		if (selectAll) {
			setSelected(new Set());
		} else {
			setSelected(new Set(filteredSessions.map((s) => s.filePath)));
		}
		setSelectAll(!selectAll);
	};

	const handleToggle = (filePath: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) {
				next.delete(filePath);
			} else {
				next.add(filePath);
			}
			setSelectAll(next.size === filteredSessions.length);
			return next;
		});
	};

	const handleDeleteSelected = () => {
		const toDelete = props.sessions.filter((s) => selected.has(s.filePath));
		if (toDelete.length === 0) return;
		props.onDelete(toDelete);
	};

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} size="xl" className={cn("flex flex-col gap-0 overflow-hidden p-0")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("menu.manageSessions")}</DialogTitle>
					<div className="flex items-center gap-2">
						<small className="text-muted-foreground">
							{filteredSessions.length} / {props.sessions.length} sessions
						</small>
						<DialogClose asChild>
							<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
								<X size={18} strokeWidth={2.2} aria-hidden="true" />
							</Button>
						</DialogClose>
					</div>
				</DialogHeader>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden border-none bg-transparent shadow-none">
				<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-muted px-5 py-2.5">
					<div className="flex items-center gap-3.5">
						<Label className="flex cursor-pointer items-center gap-2 text-control text-text-secondary select-none">
							<Checkbox
								checked={selectAll}
								onChange={handleToggleAll}
							className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
							{t("common.selectAll")}
						</Label>
						<div className="flex items-center gap-1">
							{SOURCES.map((source) => (
								<Button
									key={source}
									variant="outline"
									size="sm"
									className={`h-auto rounded-full border border-border-subtle bg-transparent px-3 py-1 text-caption font-medium text-text-tertiary transition-all duration-150 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]${activeSources.has(source) ? " border-[var(--color-accent)] bg-bg-active font-semibold text-[var(--color-accent)]" : ""}`}
									onClick={() => toggleSource(source)}
								>
									{t(`sessionSource.${source}` as any)}
								</Button>
							))}
						</div>
					</div>
					{selected.size > 0 && (
						<Button
							variant="outline" size="sm" className="h-auto gap-1 border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] px-3 py-1 text-caption font-medium text-[var(--color-danger)] shadow-none transition-all duration-150 hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
							onClick={handleDeleteSelected}
						>
							{t("common.deleteSelected", { count: selected.size })}
						</Button>
					)}
				</div>

				<div className="flex-1 overflow-y-auto bg-bg-muted">
					{filteredSessions.map((session) => {
						const isChecked = selected.has(session.filePath);
						return (
							<div
								key={session.filePath}
								className={`group flex items-center gap-3 border-b border-border-subtle bg-bg-panel px-5 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-bg-hover${isChecked ? " bg-[color:color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-panel))]" : ""}`}
							>
								<Label className="flex shrink-0 cursor-pointer items-center">
									<Checkbox
										checked={isChecked}
										onChange={() => handleToggle(session.filePath)}
									className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
								</Label>
								<div
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
									onClick={() => handleToggle(session.filePath)}
								>
									<div className="truncate text-control text-text-primary">
										{session.name || session.preview?.slice(0, 60) || t("common.untitled")}
									</div>
									{session.source && session.source !== "pi" && (
										<span className={`session-source-badge ${session.source}`}>
											{t(`sessionSource.${session.source}` as any)}
										</span>
									)}
								</div>
								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
									<Button
										variant="ghost" size="sm" className="h-auto gap-[3px] rounded-[4px] px-2 text-caption text-text-tertiary transition-all duration-150 hover:bg-bg-hover hover:text-[var(--color-accent)]"
										onClick={() => props.onRename(session)}
										title={t("common.rename")}
									>
										{t("common.rename")}
									</Button>
									<Button
										variant="ghost" size="sm" className="h-auto gap-[3px] rounded-[4px] px-2 text-caption text-text-tertiary transition-all duration-150 hover:bg-bg-hover hover:text-[var(--color-accent)]"
										onClick={() => props.onExport(session)}
										title={t("menu.exportHtml")}
									>
										{t("menu.exportHtml")}
									</Button>
									<Button
										variant="ghost" size="sm" className="h-auto gap-[3px] rounded-[4px] px-2 text-caption text-text-tertiary transition-all duration-150 hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
										onClick={() => props.onDelete([session])}
										title={t("common.delete")}
									>
										{t("common.delete")}
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * 右键菜单外壳（#115 U5）：统一 Radix DropdownMenu + 虚拟坐标 Trigger。
 * 视口碰撞翻转/焦点圈定/ESC 关闭全部由 Radix 负责；旧 useMenuPosition
 * 手写测尺寸翻转逻辑与 context-backdrop 遮罩已删除。
 * 触发器不可见但提供定位矩形（Radix dropdown-menu 无独立 Anchor 部件）。
 */
function MenuShell(props: { x: number; y: number; onClose: () => void; className?: string; children: ReactNode }) {
	return (
		<DropdownMenu open onOpenChange={(open) => { if (!open) props.onClose(); }}>
			<DropdownMenuTrigger
				aria-hidden
				tabIndex={-1}
				style={{ position: "fixed", left: props.x, top: props.y, width: 0, height: 0, padding: 0, border: 0, background: "transparent", pointerEvents: "none" }}
			/>
			<DropdownMenuContent align="start" side="bottom" className={props.className}>
				{props.children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function SessionSourceFilterMenu(props: {
	menu: { projectId: string; x: number; y: number };
	filter: ReadonlySet<SessionSource> | null;
	onToggleSource: (source: SessionSource) => void;
	onClear: () => void;
	onClose: () => void;
}) {
	const sources: SessionSource[] = ["pi", "codex", "claude", "opencode"];
	// 过滤菜单需要连续勾选，onSelect preventDefault 保持菜单打开
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose} className="min-w-44">
			<DropdownMenuLabel>{t("menu.filterSessions")}</DropdownMenuLabel>
			<DropdownMenuCheckboxItem
				checked={props.filter === null}
				onSelect={(event) => event.preventDefault()}
				onCheckedChange={(checked) => { if (checked) props.onClear(); }}
			>
				{t("menu.filterSourceAll")}
			</DropdownMenuCheckboxItem>
			<DropdownMenuSeparator />
			{sources.map((source) => (
				<DropdownMenuCheckboxItem
					key={source}
					checked={props.filter !== null && props.filter.has(source)}
					onSelect={(event) => event.preventDefault()}
					onCheckedChange={() => props.onToggleSource(source)}
				>
					<span className={`session-source-badge ${source}`}>
						{t(`sessionSource.${source}` as never)}
					</span>
				</DropdownMenuCheckboxItem>
			))}
		</MenuShell>
	);
}

export function ProjectContextMenu(props: {
	menu: { x: number; y: number; project: Project };
	onClose: () => void;
	onRevealProject: () => void;
	onOpenWithEditor: () => void;
	onImportCodexSessions: () => void;
	onImportClaudeSessions: () => void;
	onImportOpenCodeSessions: () => void;
	onManageProjectResources: () => void;
	onManageSessions: () => void;
	onFilterSessions: () => void;
	onToggleWorktree: () => void;
	onRefreshProject: () => void;
	onCopyProjectPath: () => void;
	onRemoveProject: () => void;
}) {
	const isWorktreeEnabled = props.menu.project.worktreeEnabled ?? false;
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem onSelect={props.onRevealProject}>{t("menu.revealProject")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onOpenWithEditor}>{t("app.openWithEditor")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onImportCodexSessions}>{t("menu.importCodex")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onImportClaudeSessions}>{t("menu.importClaude")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onImportOpenCodeSessions}>{t("menu.importOpenCode")}</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={props.onManageProjectResources}>{t("menu.projectResources")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onManageSessions}>{t("menu.manageSessions")}</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={props.onFilterSessions}>{t("menu.filterSessions")}</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={props.onToggleWorktree}>
				{isWorktreeEnabled ? t("menu.disableWorktree") : t("menu.enableWorktree")}
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={props.onCopyProjectPath}>{t("menu.copyProjectPath")}</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onRefreshProject}>{t("app.projectRefresh")}</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" onSelect={props.onRemoveProject}>{t("menu.removeProject")}</DropdownMenuItem>
		</MenuShell>
	);
}

export function AgentContextMenu(props: {
	menu: { x: number; y: number; agent: AgentTab };
	actionLoading?: "copy" | "export" | null;
	onClose: () => void;
	onRename: () => void;
	onExport: () => void;
	onCopySession: () => void;
	onCopySessionFilePath: () => void;
	onToggleRpcLogging?: () => void;
	isRpcLogging?: boolean;
	onOpenLogFile?: () => void;
	onOpenSessionFile?: () => void;
	onCloseAgent: () => void;
}) {
	const busy = Boolean(props.actionLoading);
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem disabled={busy} onSelect={props.onRename}>{t("common.rename")}</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onCopySession}>
				{props.actionLoading === "copy" && <span className="mini-loader" />}
				{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
			</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onExport}>
				{props.actionLoading === "export" && <span className="mini-loader" />}
				{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
			</DropdownMenuItem>
			{props.menu.agent.sessionPath && (
				<>
					<DropdownMenuItem disabled={busy} onSelect={props.onCopySessionFilePath}>
						{t("menu.copySessionFilePath")}
					</DropdownMenuItem>
					<DropdownMenuItem disabled={busy} onSelect={props.onOpenSessionFile}>
						{t("menu.openAgentSessionFile")}
					</DropdownMenuItem>
				</>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled={busy} onSelect={props.onToggleRpcLogging}>
				{props.isRpcLogging ? `✓ ${t("menu.rpcLoggingOn")}` : t("menu.rpcLogging")}
			</DropdownMenuItem>
			{props.isRpcLogging && (
				<DropdownMenuItem disabled={busy} onSelect={props.onOpenLogFile}>
					{t("menu.rpcLogFile")}
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" onSelect={props.onCloseAgent}>{t("menu.closeAgent")}</DropdownMenuItem>
		</MenuShell>
	);
}

export function DraftSessionContextMenu(props: {
	menu: { x: number; y: number };
	onClose: () => void;
	onDelete: () => void;
}) {
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem variant="destructive" onSelect={props.onDelete}>{t("common.delete")}</DropdownMenuItem>
		</MenuShell>
	);
}

export function SessionContextMenu(props: {
	menu: { x: number; y: number; session: SessionSummary };
	actionLoading?: "copy" | "export" | null;
	onClose: () => void;
	onRename: () => void;
	onExport: () => void;
	onCopySession: () => void;
	onCopySessionFilePath: () => void;
	onOpenSessionFile?: () => void;
	onShowLogs?: () => void;
	onDeleteSession: () => void;
}) {
	const busy = Boolean(props.actionLoading);
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem disabled={busy} onSelect={props.onRename}>{t("common.rename")}</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onCopySession}>
				{props.actionLoading === "copy" && <span className="mini-loader" />}
				{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
			</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onExport}>
				{props.actionLoading === "export" && <span className="mini-loader" />}
				{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled={busy} onSelect={props.onCopySessionFilePath}>
				{t("menu.copySessionFilePath")}
			</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onOpenSessionFile}>
				{t("menu.openSessionFile")}
			</DropdownMenuItem>
			<DropdownMenuItem disabled={busy} onSelect={props.onShowLogs}>{t("menu.rpcLogs")}</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" disabled={busy} onSelect={props.onDeleteSession}>
				{t("common.delete")}
			</DropdownMenuItem>
		</MenuShell>
	);
}
export function ProjectAvatar(props: {
	name: string;
	kind?: "chat" | "project";
	status?: "idle" | "running" | "starting" | "error";
}) {
	const StatusIcon = props.status === "running"
		? LoaderCircle
		: props.status === "starting"
			? CircleDot
			: props.status === "error"
				? CircleAlert
				: null;
	return (
		<div
			className={cn(
				"conversation-avatar project-avatar relative",
				props.kind === "chat" && "chat-avatar",
				props.status && `avatar-status-${props.status}`,
			)}
			title={t("app.projectAvatarTitle", { name: props.name })}
			data-avatar-status={props.status ?? "idle"}
		>
			{props.kind === "chat" ? (
				<MessageCircle size={16} strokeWidth={1.9} />
			) : (
				<Folder size={16} strokeWidth={1.8} />
			)}
			{StatusIcon && (
				<span className="avatar-status-indicator" aria-label={props.status}>
					<StatusIcon size={8} strokeWidth={2.5} className={props.status === "running" ? "animate-spin" : undefined} />
				</span>
			)}
		</div>
	);
}
export function RpcLogModal(props: {
	logs: Array<{
		id: string;
		agentId: string;
		direction: string;
		summary: string;
		time: number;
		data?: unknown;
	}>;
	onClose: () => void;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [directionFilter, setDirectionFilter] = useState<"all" | "send" | "recv">("all");
	const [keyword, setKeyword] = useState("");
	const normalizedKeyword = keyword.trim().toLowerCase();
	const visibleLogs = props.logs
		.filter((log) => directionFilter === "all" || log.direction === directionFilter)
		.filter((log) => {
			if (!normalizedKeyword) return true;
			// 搜索同时覆盖摘要和完整 JSON,方便直接查 502、terminated、auto_retry 等排障关键词。
			return formatRpcLogForCopy(log).toLowerCase().includes(normalizedKeyword);
		})
		.slice(-2000);

	useEffect(() => {
		const el = panelRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [props.logs.length, visibleLogs.length]);

	const copyLogs = (logs: typeof visibleLogs) =>
		navigator.clipboard.writeText(logs.map(formatRpcLogForCopy).join("\n"));

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1300px,calc(100vw-48px))] h-[min(850px,calc(100vh-48px))]", "sm:max-w-[min(1000px,92vw)] h-[min(720px,82vh)]")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("rpc.title", {
						visible: visibleLogs.length,
						total: props.logs.length,
					})}</DialogTitle>
					<div className="flex items-center gap-2">
						<Button variant="default" onClick={() => copyLogs(props.logs)}>
							{t("common.copyAll")}
						</Button>
						<Button variant="secondary" onClick={() => copyLogs(visibleLogs)}>
							{t("common.copyVisible")}
						</Button>
						<DialogClose asChild>
							<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
								<X size={18} strokeWidth={2.2} aria-hidden="true" />
							</Button>
						</DialogClose>
					</div>
				</DialogHeader>
			<div className="rpc-log-modal rpc-log-modal--embedded">
				<div className="rpc-log-toolbar">
					<div className="rpc-log-filter-tabs">
						<Button
							variant="outline"
							size="sm"
							className={`h-auto px-2 py-1 text-caption shadow-none${directionFilter === "all" ? " active" : ""}`}
							onClick={() => setDirectionFilter("all")}
						>
							{t("rpc.filterAll")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className={`h-auto px-2 py-1 text-caption shadow-none${directionFilter === "send" ? " active" : ""}`}
							onClick={() => setDirectionFilter("send")}
						>
							{t("rpc.filterSend")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className={`h-auto px-2 py-1 text-caption shadow-none${directionFilter === "recv" ? " active" : ""}`}
							onClick={() => setDirectionFilter("recv")}
						>
							{t("rpc.filterReceive")}
						</Button>
					</div>
					<Input
						value={keyword}
						onChange={(e) => setKeyword(e.target.value)}
						placeholder={t("rpc.searchPlaceholder")}
					/>
				</div>
				<div className="rpc-log-list" ref={panelRef}>
					{visibleLogs.map((log) => {
						const jsonText = JSON.stringify(log.data ?? {}, null, 2);
						return (
							<div key={log.id} className="rpc-log-entry-wrap">
								<div
									className={`rpc-log-entry ${log.direction === "send" ? "log-send" : "log-recv"}`}
									onClick={() =>
										setExpandedId(expandedId === log.id ? null : log.id)
									}
								>
									<time>
										{new Date(log.time).toLocaleTimeString(undefined, {
											hour: "2-digit",
											minute: "2-digit",
											second: "2-digit",
										})}
									</time>
									<span className="log-direction">
										{log.direction === "send" ? "→" : "←"}
									</span>
									<span className="log-summary">{log.summary}</span>
									<div className="rpc-log-entry-actions" onClick={(event) => event.stopPropagation()}>
										<Button variant="outline" size="sm" className="h-auto px-2 py-1 text-caption shadow-none" onClick={() => navigator.clipboard.writeText(formatRpcLogForCopy(log))}>
											{t("common.copy")}
										</Button>
										<Button variant="outline" size="sm" className="h-auto px-2 py-1 text-caption shadow-none" onClick={() => navigator.clipboard.writeText(jsonText)}>
											{t("rpc.copyJson")}
										</Button>
									</div>
								</div>
								{expandedId === log.id && log.data != null && (
									<pre className="rpc-log-detail">{jsonText}</pre>
								)}
							</div>
						);
					})}
					{visibleLogs.length === 0 && (
						<div className="rpc-log-empty">
							{t("rpc.empty")}
						</div>
					)}
				</div>
			</div>
			</DialogContent>
		</Dialog>
	);
}

function formatRpcLogForCopy(log: {
	agentId: string;
	direction: string;
	summary: string;
	time: number;
	data?: unknown;
}) {
	return JSON.stringify({
		time: new Date(log.time).toISOString(),
		agentId: log.agentId,
		direction: log.direction,
		summary: log.summary,
		data: log.data,
	});
}

type EntryAction = {
	active?: boolean;
	label: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	icon: ReactNode;
};
export function WorktreeCreateDialog(props: {
	projectId: string;
	creating: boolean;
	onCreate: (branchName: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// 预览最终创建的分支名，与后端 WorktreeService.slugify 保持一致：
	// 保留 Unicode 字母数字，其余字符替换为 -。让用户在提交前看到中文/特殊字符的实际结果，
	// 避免输入与最终分支名脱节。
	const previewSlug = useMemo(() => {
		const slug = name
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+/, "")
			.replace(/-+$/, "");
		return slug || "workspace";
	}, [name]);

	// #115 U5：外壳换 shadcn Dialog；分支名预览逻辑不变
	return (
		<Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
			<DialogContent className="sm:max-w-sm worktree-create-dialog">
				<DialogHeader>
					<DialogTitle>{t("app.worktreeCreateTitle")}</DialogTitle>
				</DialogHeader>
				<Input
					ref={inputRef}
					type="text"
					className="worktree-create-input"
					placeholder={t("app.worktreeCreatePlaceholder")}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && name.trim()) {
							props.onCreate(name.trim());
						}
						if (e.key === "Escape") props.onClose();
					}}
					disabled={props.creating}
				/>
				{name.trim() && (
					<p className="worktree-create-preview">
						{t("app.worktreeBranchPreview", { name: previewSlug })}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={props.onClose} disabled={props.creating}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={!name.trim() || props.creating}
						onClick={() => props.onCreate(name.trim())}
					>
						{props.creating ? t("app.worktreeCreating") : t("app.worktreeCreate")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
