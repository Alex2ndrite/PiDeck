import { useState, useRef, useLayoutEffect, useEffect, useMemo, type ReactNode } from "react";
import { X, MessageCircle, Folder } from "lucide-react";
import { t } from "../../i18n";
import { CloseIconButton } from "../ui/IconButton";
import type { SessionSummary, Project, AgentTab } from "../../../../shared/types";

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
		<div className="modal-backdrop" onClick={props.onClose}>
			<section className="session-manager-modal" onClick={(e) => e.stopPropagation()}>
				<header className="modal-header">
					<div>
						<strong>{t("menu.manageSessions")}</strong>
						<small>{filteredSessions.length} / {props.sessions.length} sessions</small>
					</div>
					<button
						className="modal-close"
						onClick={props.onClose}
						aria-label={t("common.close")}
					>
						<X size={18} strokeWidth={2} />
					</button>
				</header>

				<div className="session-manager-toolbar">
					<div className="session-manager-toolbar-left">
						<label className="session-manager-select-all">
							<input
								type="checkbox"
								checked={selectAll}
								onChange={handleToggleAll}
							/>
							{t("common.selectAll")}
						</label>
						<div className="session-manager-source-filters">
							{SOURCES.map((source) => (
								<button
									key={source}
									className={`session-source-btn${activeSources.has(source) ? " active" : ""}`}
									onClick={() => toggleSource(source)}
								>
									{t(`sessionSource.${source}` as any)}
								</button>
							))}
						</div>
					</div>
					{selected.size > 0 && (
						<button
							className="session-manager-delete-btn"
							onClick={handleDeleteSelected}
						>
							{t("common.deleteSelected", { count: selected.size })}
						</button>
					)}
				</div>

				<div className="session-manager-list">
					{filteredSessions.map((session) => {
						const isChecked = selected.has(session.filePath);
						return (
							<div
								key={session.filePath}
								className={`session-manager-row${isChecked ? " selected" : ""}`}
							>
								<label className="session-manager-row-checkbox">
									<input
										type="checkbox"
										checked={isChecked}
										onChange={() => handleToggle(session.filePath)}
									/>
								</label>
								<div
									className="session-manager-row-info"
									onClick={() => handleToggle(session.filePath)}
								>
									<div className="session-manager-row-name">
										{session.name || session.preview?.slice(0, 60) || t("common.untitled")}
									</div>
									{session.source && session.source !== "pi" && (
										<span className={`session-source-badge ${session.source}`}>
											{t(`sessionSource.${session.source}` as any)}
										</span>
									)}
								</div>
								<div className="session-manager-row-actions">
									<button
										className="session-manager-action-btn"
										onClick={() => props.onRename(session)}
										title={t("common.rename")}
									>
										{t("common.rename")}
									</button>
									<button
										className="session-manager-action-btn"
										onClick={() => props.onExport(session)}
										title={t("menu.exportHtml")}
									>
										{t("menu.exportHtml")}
									</button>
									<button
										className="session-manager-action-btn danger"
										onClick={() => props.onDelete([session])}
										title={t("common.delete")}
									>
										{t("common.delete")}
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}

/**
 * 右键菜单定位：渲染后按真实尺寸修正位置。
 * 当菜单超出视口底部/右侧时向上/向左翻转，仍放不下则夹紧到视口内，
 * 保证整块菜单始终可见、不被屏幕裁切（不使用滚动）。
 */
function useMenuPosition(initial: { x: number; y: number }) {
	const [pos, setPos] = useState(initial);
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let { x, y } = initial;
		// 下方空间不足时翻转到光标上方，仍放不下则夹紧到视口内
		if (y + rect.height > vh) {
			const flipped = y - rect.height;
			y = flipped >= 8 ? flipped : Math.max(8, vh - rect.height - 8);
		}
		// 右侧空间不足时翻转到光标左侧，仍放不下则夹紧到视口内
		if (x + rect.width > vw) {
			const flipped = x - rect.width;
			x = flipped >= 8 ? flipped : Math.max(8, vw - rect.width - 8);
		}
		if (x !== pos.x || y !== pos.y) setPos({ x, y });
	}, [initial.x, initial.y]);
	return { pos, ref };
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
	const { pos, ref } = useMenuPosition(props.menu);
	return (
		<div className="context-backdrop" onClick={props.onClose}>
			<div
				className="context-menu"
				style={{ left: pos.x, top: pos.y }}
				ref={ref}
				onClick={(event) => event.stopPropagation()}
			>
				<button onClick={props.onRevealProject}>{t("menu.revealProject")}</button>
				<button onClick={props.onOpenWithEditor}>{t("app.openWithEditor")}</button>
				<button onClick={props.onImportCodexSessions}>
					{t("menu.importCodex")}
				</button>
				<button onClick={props.onImportClaudeSessions}>
					{t("menu.importClaude")}
				</button>
				<button onClick={props.onImportOpenCodeSessions}>
					{t("menu.importOpenCode")}
				</button>
				<hr className="context-separator" />
				<button onClick={props.onManageProjectResources}>{t("menu.projectResources")}</button>
				<button onClick={props.onManageSessions}>{t("menu.manageSessions")}</button>
				<hr className="context-separator" />
				<button onClick={props.onFilterSessions}>{t("menu.filterSessions")}</button>
				<hr className="context-separator" />
				<button onClick={props.onToggleWorktree}>
					{isWorktreeEnabled ? t("menu.disableWorktree") : t("menu.enableWorktree")}
				</button>
				<hr className="context-separator" />
				<button onClick={props.onCopyProjectPath}>{t("menu.copyProjectPath")}</button>
				<hr className="context-separator" />
				<button onClick={props.onRefreshProject}>{t("app.projectRefresh")}</button>
				<hr className="context-separator" />
				<button onClick={props.onRemoveProject}>{t("menu.removeProject")}</button>
			</div>
		</div>
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
	const { pos, ref } = useMenuPosition(props.menu);
	return (
		<div className="context-backdrop" onClick={props.onClose}>
			<div
				className="context-menu"
				style={{ left: pos.x, top: pos.y }}
				ref={ref}
				onClick={(event) => event.stopPropagation()}
			>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onRename}>{t("common.rename")}</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onCopySession}>
					{props.actionLoading === "copy" && <span className="mini-loader" />}
					{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
				</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onExport}>
					{props.actionLoading === "export" && <span className="mini-loader" />}
					{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
				</button>
				{props.menu.agent.sessionPath && (
					<>
						<button disabled={Boolean(props.actionLoading)} onClick={props.onCopySessionFilePath}>
							{t("menu.copySessionFilePath")}
						</button>
						<button disabled={Boolean(props.actionLoading)} onClick={props.onOpenSessionFile}>
							{t("menu.openAgentSessionFile")}
						</button>
					</>
				)}
				<button disabled={Boolean(props.actionLoading)} onClick={props.onToggleRpcLogging}>
					{props.isRpcLogging ? `✓ ${t("menu.rpcLoggingOn")}` : t("menu.rpcLogging")}
				</button>
				{props.isRpcLogging && (
					<button disabled={Boolean(props.actionLoading)} onClick={props.onOpenLogFile}>
						{t("menu.rpcLogFile")}
					</button>
				)}
				<button className="danger" onClick={props.onCloseAgent}>{t("menu.closeAgent")}</button>
			</div>
		</div>
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
	const { pos, ref } = useMenuPosition(props.menu);
	return (
		<div className="context-backdrop" onClick={props.onClose}>
			<div
				className="context-menu"
				style={{ left: pos.x, top: pos.y }}
				ref={ref}
				onClick={(event) => event.stopPropagation()}
			>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onRename}>{t("common.rename")}</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onCopySession}>
					{props.actionLoading === "copy" && <span className="mini-loader" />}
					{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
				</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onExport}>
					{props.actionLoading === "export" && <span className="mini-loader" />}
					{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
				</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onCopySessionFilePath}>
					{t("menu.copySessionFilePath")}
				</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onOpenSessionFile}>
					{t("menu.openSessionFile")}
				</button>
				<button disabled={Boolean(props.actionLoading)} onClick={props.onShowLogs}>{t("menu.rpcLogs")}</button>
				<button
					className="danger"
					disabled={Boolean(props.actionLoading)}
					onClick={props.onDeleteSession}
				>
					{t("common.delete")}
				</button>
			</div>
		</div>
	);
}
export function ProjectAvatar(props: { name: string; kind?: "chat" | "project" }) {
	return (
		<div
			className={`conversation-avatar project-avatar${props.kind === "chat" ? " chat-avatar" : ""}`}
			title={t("app.projectAvatarTitle", { name: props.name })}
		>
			{props.kind === "chat" ? (
				<MessageCircle size={16} strokeWidth={1.9} />
			) : (
				<Folder size={16} strokeWidth={1.8} />
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
		<div className="modal-backdrop" onClick={props.onClose}>
			<div className="rpc-log-modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header rpc-log-header">
					<strong>
						{t("rpc.title", {
							visible: visibleLogs.length,
							total: props.logs.length,
						})}
					</strong>
					<div className="modal-header-actions rpc-log-header-actions">
						<button className="config-btn primary" onClick={() => copyLogs(props.logs)}>
							{t("common.copyAll")}
						</button>
						<button className="config-btn blue" onClick={() => copyLogs(visibleLogs)}>
							{t("common.copyVisible")}
						</button>
						<CloseIconButton
							label={t("common.close")}
							onClick={props.onClose}
						/>
					</div>
				</div>
				<div className="rpc-log-toolbar">
					<div className="rpc-log-filter-tabs">
						<button
							className={directionFilter === "all" ? "active" : ""}
							onClick={() => setDirectionFilter("all")}
						>
							{t("rpc.filterAll")}
						</button>
						<button
							className={directionFilter === "send" ? "active" : ""}
							onClick={() => setDirectionFilter("send")}
						>
							{t("rpc.filterSend")}
						</button>
						<button
							className={directionFilter === "recv" ? "active" : ""}
							onClick={() => setDirectionFilter("recv")}
						>
							{t("rpc.filterReceive")}
						</button>
					</div>
					<input
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
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
										<button onClick={() => navigator.clipboard.writeText(formatRpcLogForCopy(log))}>
											{t("common.copy")}
										</button>
										<button onClick={() => navigator.clipboard.writeText(jsonText)}>
											{t("rpc.copyJson")}
										</button>
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
		</div>
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

	return (
		<div className="context-backdrop worktree-create-backdrop" onClick={props.onClose}>
			<div
				className="worktree-create-dialog"
				onClick={(e) => e.stopPropagation()}
			>
				<h3>{t("app.worktreeCreateTitle")}</h3>
				<input
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
				<div className="worktree-create-actions">
					<button
						className="worktree-create-cancel"
						onClick={props.onClose}
						disabled={props.creating}
					>
						{t("common.cancel")}
					</button>
					<button
						className="worktree-create-confirm"
						disabled={!name.trim() || props.creating}
						onClick={() => props.onCreate(name.trim())}
					>
						{props.creating ? t("app.worktreeCreating") : t("app.worktreeCreate")}
					</button>
				</div>
			</div>
		</div>
	);
}
