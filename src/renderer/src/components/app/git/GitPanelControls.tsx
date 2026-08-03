import {
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { Twistie } from "./GitResourceTree";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../ui-shadcn/select";
import { cn } from "../../../lib/utils";

export function PaneHeader(props: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <button
        type="button"
        className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-foreground hover:bg-accent"
        aria-expanded={props.open}
        aria-controls={`git-pane-${props.id}`}
        onClick={props.onToggle}
      >
        <Twistie open={props.open} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tracking-normal uppercase text-[var(--git-panel-fg)]">{props.title}</span>
      </button>
      {props.children && (
        <div className="flex shrink-0 items-center gap-0.5">{props.children}</div>
      )}
      {typeof props.count === "number" && props.count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{props.count}</span>
      )}
    </div>
  );
}

/**
 * Compact Git pane filter：自绘 listbox 已替换为 shadcn Select（#115 U5 统一交互原语）。
 * Radix Select 负责 portal、视口碰撞、ESC、焦点圈定与 aria，删除手写定位和 scroll/resize 监听。
 */
export function GitCompactFilter(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const selected = props.options.find((option) => option.value === props.value);
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        aria-label={props.ariaLabel}
        className={cn(
          "h-6 min-w-0 gap-1 overflow-hidden rounded-sm border border-transparent px-2 font-mono text-[13px] whitespace-nowrap text-text-primary transition-[border-color,background-color] duration-150 hover:border-border-subtle hover:bg-bg-hover focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none [&>svg]:size-3",
          props.className,
        )}
      >
        <span className="max-w-[80px] truncate">{selected?.label ?? props.value}</span>
      </SelectTrigger>
      <SelectContent className="min-w-40">
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.label}</span>
              {option.value === props.value && (
                <Check size={12} className="ml-auto shrink-0 text-[color:var(--color-accent)]" />
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
