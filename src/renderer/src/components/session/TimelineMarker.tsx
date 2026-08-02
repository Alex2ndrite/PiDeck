import type { ReactNode } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  CircleDot,
  MessageCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

export type TimelineMarkerKind = "thinking" | "tool" | "compaction" | "diagnostic" | "ask";
export type TimelineMarkerTone = "neutral" | "active" | "success" | "warning" | "error";

const MARKER_ICONS: Record<TimelineMarkerKind, LucideIcon> = {
  thinking: Brain,
  tool: Wrench,
  compaction: CircleDot,
  diagnostic: AlertTriangle,
  ask: MessageCircle,
};

const TONE_CLASSES: Record<TimelineMarkerTone, string> = {
  neutral: "bg-muted-foreground/60 text-muted-foreground",
  active: "bg-primary text-primary-foreground",
  success: "bg-emerald-600 text-white dark:bg-emerald-500",
  warning: "bg-amber-500 text-white dark:bg-amber-400",
  error: "bg-destructive text-destructive-foreground",
};

/**
 * 时间线事件的统一左侧标记轨道。
 *
 * 事件内容本身仍由各业务卡片负责，Marker 只承载类型、状态和归属关系，
 * 这样工具调用、思考、压缩和诊断消息不会因为各自的卡片样式而失去时间线层级。
 */
export function TimelineMarker(props: {
  kind: TimelineMarkerKind;
  tone?: TimelineMarkerTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = MARKER_ICONS[props.kind];
  const tone = props.tone ?? "neutral";
  return (
    <div className={cn("timeline-marker-row flex min-w-0 items-stretch gap-2", props.className)} data-marker-kind={props.kind} data-marker-tone={tone}>
      <div className="relative flex w-5 shrink-0 justify-center" aria-hidden="true">
        <span className="absolute top-0 bottom-0 w-px bg-border-subtle" />
        <span className={cn("relative z-[1] mt-1 grid size-5 place-items-center rounded-full", TONE_CLASSES[tone])}>
          <Icon size={12} strokeWidth={2.2} />
        </span>
      </div>
      <div className="min-w-0 flex-1 pb-2">{props.children}</div>
    </div>
  );
}

/** 状态完成标记，供详情或完成态卡片复用，避免各域自行拼图标和颜色。 */
export function TimelineSuccessMarker() {
  return (
    <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500" aria-hidden="true">
      <Check size={12} strokeWidth={2.5} />
    </span>
  );
}
