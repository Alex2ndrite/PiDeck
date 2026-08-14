import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAtomValue } from "jotai";
import { Activity, Clock, Hash, Wrench } from "lucide-react";
import type { AgentRuntimeState, ChatMessage } from "../../../../../shared/types";
import { sessionRuntimeBySessionIdAtomFamily } from "../../../atoms";
import { t } from "../../../i18n";
import { formatDuration, formatTime } from "../TimelineFormat";
import {
	buildTrajectory,
	filterRecordsByRange,
	type TrajectoryLane,
	type TrajectoryRecord,
	type TrajectoryTimeRange,
} from "./buildTrajectory";

const LANE_ORDER: TrajectoryLane[] = ["input", "model", "tools"];
const MIN_DRAG_PX = 4;
const MIN_ZOOM_SPAN_MS = 40;

function laneLabel(lane: TrajectoryLane): string {
	if (lane === "input") return t("session.trajectory.lane.input");
	if (lane === "tools") return t("session.trajectory.lane.tools");
	return t("session.trajectory.lane.model");
}

function kindLabel(kind: TrajectoryRecord["kind"]): string {
	if (kind === "user") return t("session.trajectory.kind.user");
	if (kind === "assistant") return t("session.trajectory.kind.assistant");
	if (kind === "thinking") return t("session.trajectory.kind.thinking");
	if (kind === "tool") return t("session.trajectory.kind.tool");
	if (kind === "error") return t("session.trajectory.kind.error");
	return t("session.trajectory.kind.system");
}

function laneTone(lane: TrajectoryLane): string {
	if (lane === "input") return "bg-primary/70";
	if (lane === "tools") return "bg-amber-500/75 dark:bg-amber-400/70";
	return "bg-sky-500/70 dark:bg-sky-400/65";
}

function projectLeft(start: number, domainStart: number, span: number): number {
	if (span <= 0) return 0;
	return ((start - domainStart) / span) * 100;
}

function projectWidth(start: number, end: number, domainStart: number, span: number): number {
	if (span <= 0) return 100;
	return Math.max(((end - start) / span) * 100, 0.35);
}

function formatClock(ts: number): string {
	return new Date(ts).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

/**
 * 会话轨迹复盘：3-lane 时间线 + turn 账本 + 选中 inspector。
 * 数据来自当前栏已加载的 ChatMessage（含历史页），不另开 IPC。
 */
export function SessionTrajectoryView(props: {
	sessionId: string;
	messages: ChatMessage[];
	hasMoreMessages?: boolean;
	isLoadingMoreMessages?: boolean;
	onLoadMore?: () => void;
}) {
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(props.sessionId));
	const [now, setNow] = useState(() => Date.now());
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [range, setRange] = useState<TrajectoryTimeRange | undefined>(undefined);
	const model = useMemo(() => buildTrajectory(props.messages, now), [props.messages, now]);
	const visible = useMemo(() => filterRecordsByRange(model.records, range), [model.records, range]);
	const selected = visible.find((record) => record.id === selectedId) ?? model.records.find((record) => record.id === selectedId);

	const refreshNow = useCallback(() => {
		if (model.turns.some((turn) => turn.inFlight)) setNow(Date.now());
	}, [model.turns]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-background" data-session-view="trajectory">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
					<Activity size={14} aria-hidden="true" />
					<span>{t("session.trajectory.turns", { count: model.turns.length })}</span>
					<span aria-hidden="true">·</span>
					<span>{t("session.trajectory.records", { count: visible.length })}</span>
					{range ? (
						<button
							type="button"
							className="rounded-sm px-1.5 text-caption text-primary hover:underline"
							onClick={() => setRange(undefined)}
						>
							{t("session.trajectory.clearRange")}
						</button>
					) : null}
				</div>
				{props.hasMoreMessages ? (
					<button
						type="button"
						className="rounded-sm px-1.5 text-caption text-muted-foreground hover:text-foreground"
						disabled={props.isLoadingMoreMessages}
						onClick={props.onLoadMore}
					>
						{props.isLoadingMoreMessages
							? t("session.trajectory.loadingOlder")
							: t("session.trajectory.loadOlder")}
					</button>
				) : null}
			</div>
			<TrajectoryOverview
				records={model.records}
				domainStart={model.domainStart}
				domainEnd={model.domainEnd}
				range={range}
				selectedId={selected?.id}
				onSelect={setSelectedId}
				onRangeChange={setRange}
				onHoverTick={refreshNow}
			/>
			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(220px,32%)]">
				<TrajectoryLedger
					records={visible}
					selectedId={selected?.id}
					onSelect={setSelectedId}
				/>
				<TrajectoryInspector record={selected} runtimeState={runtime?.state} />
			</div>
		</div>
	);
}

function TrajectoryOverview(props: {
	records: TrajectoryRecord[];
	domainStart: number;
	domainEnd: number;
	range?: TrajectoryTimeRange;
	selectedId?: string;
	onSelect: (id: string) => void;
	onRangeChange: (range: TrajectoryTimeRange | undefined) => void;
	onHoverTick: () => void;
}) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{ x: number; start: number } | undefined>(undefined);
	const [draft, setDraft] = useState<TrajectoryTimeRange | undefined>(undefined);
	const span = Math.max(props.domainEnd - props.domainStart, 1);

	const timeAt = useCallback((clientX: number): number => {
		const el = trackRef.current;
		if (!el) return props.domainStart;
		const rect = el.getBoundingClientRect();
		const ratio = rect.width <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		return props.domainStart + ratio * span;
	}, [props.domainStart, span]);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { x: event.clientX, start: timeAt(event.clientX) };
		setDraft(undefined);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		props.onHoverTick();
		const drag = dragRef.current;
		if (!drag) return;
		if (Math.abs(event.clientX - drag.x) < MIN_DRAG_PX && !draft) return;
		const end = timeAt(event.clientX);
		setDraft({ start: Math.min(drag.start, end), end: Math.max(drag.start, end) });
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		dragRef.current = undefined;
		if (!drag) return;
		if (Math.abs(event.clientX - drag.x) < MIN_DRAG_PX) {
			setDraft(undefined);
			return;
		}
		const end = timeAt(event.clientX);
		props.onRangeChange({ start: Math.min(drag.start, end), end: Math.max(drag.start, end) });
		setDraft(undefined);
	};

	const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
		if (props.records.length === 0) return;
		event.preventDefault();
		const current = props.range ?? { start: props.domainStart, end: props.domainEnd };
		const width = Math.max(current.end - current.start, MIN_ZOOM_SPAN_MS);
		const factor = event.deltaY > 0 ? 1.2 : 0.8;
		const nextWidth = Math.min(span, Math.max(MIN_ZOOM_SPAN_MS, width * factor));
		const anchor = timeAt(event.clientX);
		const leftRatio = (anchor - current.start) / width;
		let start = anchor - nextWidth * leftRatio;
		let end = start + nextWidth;
		if (start < props.domainStart) {
			start = props.domainStart;
			end = start + nextWidth;
		}
		if (end > props.domainEnd) {
			end = props.domainEnd;
			start = end - nextWidth;
		}
		props.onRangeChange({ start, end });
	};

	const highlight = draft ?? props.range;

	return (
		<div className="shrink-0 border-b border-border/60 px-3 py-2">
			<div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2">
				<div className="flex h-[50px] flex-col justify-between py-0.5 text-[10px] leading-none text-muted-foreground">
					{LANE_ORDER.map((lane) => (
						<span key={lane}>{laneLabel(lane)}</span>
					))}
				</div>
				<div
					ref={trackRef}
					className="relative h-[50px] cursor-crosshair touch-none rounded-sm bg-muted/40"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={() => {
						dragRef.current = undefined;
						setDraft(undefined);
					}}
					onWheel={onWheel}
					onDoubleClick={() => props.onRangeChange(undefined)}
				>
					{highlight ? (
						<div
							className="pointer-events-none absolute inset-y-0 bg-primary/10"
							style={{
								left: `${projectLeft(highlight.start, props.domainStart, span)}%`,
								width: `${projectWidth(highlight.start, highlight.end, props.domainStart, span)}%`,
							}}
						/>
					) : null}
					{LANE_ORDER.map((lane, laneIndex) => (
						<div
							key={lane}
							className="pointer-events-none absolute right-0 left-0"
							style={{ top: `${laneIndex * 33.33}%`, height: "33.33%" }}
						>
							{props.records
								.filter((record) => record.lane === lane)
								.map((record) => {
									const end = record.endedAt ?? props.domainEnd;
									const selected = record.id === props.selectedId;
									return (
										<button
											key={record.id}
											type="button"
											title={`${kindLabel(record.kind)} · ${record.summary}`}
											className={`pointer-events-auto absolute top-1/2 h-2 -translate-y-1/2 rounded-sm ${laneTone(lane)} ${selected ? "ring-1 ring-foreground" : ""}`}
											style={{
												left: `${projectLeft(record.startedAt, props.domainStart, span)}%`,
												width: `${projectWidth(record.startedAt, end, props.domainStart, span)}%`,
											}}
											onClick={(event) => {
												event.stopPropagation();
												props.onSelect(record.id);
											}}
										/>
									);
								})}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function TrajectoryLedger(props: {
	records: TrajectoryRecord[];
	selectedId?: string;
	onSelect: (id: string) => void;
}) {
	let lastTurn = -1;
	return (
		<div className="min-h-0 overflow-auto border-r border-border/60">
			{props.records.length === 0 ? (
				<div className="px-3 py-6 text-center text-caption text-muted-foreground">
					{t("session.trajectory.empty")}
				</div>
			) : (
				<ul className="divide-y divide-border/50">
					{props.records.map((record) => {
						const showTurn = record.turnIndex !== lastTurn;
						lastTurn = record.turnIndex;
						const selected = record.id === props.selectedId;
						return (
							<li key={record.id}>
								{showTurn ? (
									<div className="bg-muted/40 px-3 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
										{t("session.trajectory.turn", { index: record.turnIndex + 1 })}
									</div>
								) : null}
								<button
									type="button"
									className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-caption hover:bg-muted/50 ${selected ? "bg-muted" : ""}`}
									onClick={() => props.onSelect(record.id)}
								>
									<span className={`mt-1 size-1.5 shrink-0 rounded-full ${laneTone(record.lane)}`} />
									<span className="w-16 shrink-0 font-medium text-foreground">{kindLabel(record.kind)}</span>
									<span className="min-w-0 flex-1 truncate text-muted-foreground">{record.summary || "—"}</span>
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{record.durationMs === undefined ? t("session.trajectory.inFlight") : formatDuration(record.durationMs)}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function TrajectoryInspector(props: {
	record?: TrajectoryRecord;
	runtimeState?: AgentRuntimeState;
}) {
	const record = props.record;
	const state = props.runtimeState;
	if (!record) {
		return (
			<div className="min-h-0 overflow-auto px-3 py-4 text-caption text-muted-foreground">
				{t("session.trajectory.inspectHint")}
			</div>
		);
	}
	return (
		<div className="min-h-0 overflow-auto px-3 py-3">
			<div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
				{record.kind === "tool" ? <Wrench size={14} /> : <Hash size={14} />}
				{record.kind === "tool" ? record.toolName : kindLabel(record.kind)}
			</div>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
				<dt className="text-muted-foreground">{t("session.trajectory.field.time")}</dt>
				<dd className="tabular-nums">{formatTime(record.startedAt)} · {formatClock(record.startedAt)}</dd>
				<dt className="text-muted-foreground">{t("session.trajectory.field.duration")}</dt>
				<dd className="tabular-nums">
					{record.durationMs === undefined ? t("session.trajectory.inFlight") : formatDuration(record.durationMs)}
				</dd>
				{record.status ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.status")}</dt>
						<dd>{record.status}</dd>
					</>
				) : null}
				{record.toolCallId ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.callId")}</dt>
						<dd className="truncate font-mono text-[11px]">{record.toolCallId}</dd>
					</>
				) : null}
			</dl>
			{record.detail || record.text ? (
				<pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap">
					{record.detail || record.text}
				</pre>
			) : null}
			{state && (state.ttftMs !== undefined || state.inputTokens !== undefined) ? (
				<div className="mt-4 border-t border-border/60 pt-3">
					<div className="mb-1 flex items-center gap-1 text-caption font-medium">
						<Clock size={12} />
						{t("session.trajectory.runtime")}
					</div>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption text-muted-foreground">
						{state.ttftMs !== undefined ? (
							<>
								<dt>TTFT</dt>
								<dd className="tabular-nums">{formatDuration(state.ttftMs)}</dd>
							</>
						) : null}
						{state.totalMs !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.total")}</dt>
								<dd className="tabular-nums">{formatDuration(state.totalMs)}</dd>
							</>
						) : null}
						{state.tps !== undefined ? (
							<>
								<dt>TPS</dt>
								<dd className="tabular-nums">{state.tps.toFixed(1)}</dd>
							</>
						) : null}
						{state.inputTokens !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.inputTokens")}</dt>
								<dd className="tabular-nums">{state.inputTokens}</dd>
							</>
						) : null}
						{state.outputTokens !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.outputTokens")}</dt>
								<dd className="tabular-nums">{state.outputTokens}</dd>
							</>
						) : null}
						{state.cacheRead !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.cacheRead")}</dt>
								<dd className="tabular-nums">{state.cacheRead}</dd>
							</>
						) : null}
					</dl>
				</div>
			) : null}
		</div>
	);
}
