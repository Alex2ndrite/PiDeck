import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLogEntry, AppLogLevel } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { desktopApi } from "../../../desktopApi";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../ui-shadcn/select";
import { LogsDatePicker } from "./LogsDatePicker";

const LEVELS: Array<AppLogLevel | "all"> = ["all", "debug", "info", "warn", "error"];

function formatTime(time: number) {
	return new Date(time).toLocaleString();
}

function formatDetail(detail: unknown) {
	if (detail == null) return "";
	try {
		return JSON.stringify(detail, null, 2);
	} catch {
		return String(detail);
	}
}

/**
 * 应用日志查看器（由 Pi 管理界面「日志」tab 迁入设置）。
 * 只负责查看（级别/关键词/日期筛选 + 列表展开详情）；清除/打开文件夹
 * 由「缓存与日志」tab 的应用日志管理行承担，避免两处重复入口。
 */
export function LogViewer() {
	const [entries, setEntries] = useState<AppLogEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [level, setLevel] = useState<AppLogLevel | "all">("all");
	const [search, setSearch] = useState("");
	const [from, setFrom] = useState("");
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const query = useMemo(() => ({
		level,
		search,
		from: from ? new Date(from).getTime() : undefined,
		limit: 500,
	}), [level, search, from]);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setEntries(await desktopApi.logs.list(query));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [query]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void refresh();
		}, 150);
		return () => window.clearTimeout(timer);
	}, [refresh]);

	return (
		<div className="logs-tab">
			{/* 工具栏（UI 2.0）：级别 + 搜索 + 日期 + 刷新，一行左对齐，窄时自动换行 */}
			<div className="mb-3.5 flex flex-wrap items-center gap-2">
				<Select value={level} onValueChange={(value) => setLevel(value as AppLogLevel | "all")}>
					<SelectTrigger className="w-28" aria-label={t("logs.levelFilter")}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{LEVELS.map((item) => (
							<SelectItem key={item} value={item}>
								{t(`logs.level.${item}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					className="w-72 max-w-full"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder={t("logs.searchPlaceholder")}
				/>
				<LogsDatePicker
					value={from}
					onChange={setFrom}
					placeholder={t("logs.sinceFilter")}
					clearLabel={t("logs.clearSinceFilter")}
				/>
				<Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
					{t("common.refresh")}
				</Button>
			</div>
			{error && <div className="mb-3.5 rounded-sm border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-control leading-relaxed text-danger whitespace-pre-line">{error}</div>}
			{loading ? (
				<div className="py-12 text-center text-control text-text-tertiary">{t("common.loading")}</div>
			) : entries.length === 0 ? (
				<div className="py-12 text-center text-control text-text-tertiary">{t("logs.empty")}</div>
			) : (
				<div className="logs-list">
					{entries.map((entry) => {
						const expanded = expandedId === entry.id;
						return (
							<article key={entry.id} className={`log-row ${entry.level}`}>
								<Button size="sm" variant="ghost" className="log-row-main w-full justify-start" onClick={() => setExpandedId(expanded ? null : entry.id)}>
									<span className="log-time">{formatTime(entry.time)}</span>
									<span className={`log-level ${entry.level}`}>{entry.level}</span>
									<span className="log-scope">{entry.scope}</span>
									<span className="log-message">{entry.message}</span>
								</Button>
								{expanded && (
									<pre className="log-detail">{formatDetail(entry.detail) || t("logs.noDetail")}</pre>
								)}
							</article>
						);
					})}
				</div>
			)}
		</div>
	);
}
