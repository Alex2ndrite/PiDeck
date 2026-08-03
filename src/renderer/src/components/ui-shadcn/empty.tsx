import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * shadcn 风格空态原语：统一的标题/描述/占位区/操作按钮编排。
 * 只负责结构，不携带业务数据；业务侧（ProjectEmptyState 等）负责传入文案
 * 与快捷操作，符合 AGENTS 中“新增能力走注册式原语、避免在既有 switch 上加分支”的要求。
 */
export function Empty(props: {
  /** 图标占位（如 lucide 图标或品牌 LogoMark）；不传则不渲染图标区 */
  icon?: ReactNode;
  title: ReactNode;
  /** 说明文字；可选 */
  description?: ReactNode;
  /** 底部操作区（如多个快捷按钮） */
  actions?: ReactNode;
  /** actions 下方补充内容（如 pi 配置默认值提示）；可选 */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-full flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center",
        props.className,
      )}
    >
      {props.icon && (
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
          {props.icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-semibold leading-6 text-foreground">
          {props.title}
        </h3>
        {props.description && (
          <p className="max-w-md text-sm leading-5 text-muted-foreground">
            {props.description}
          </p>
        )}
      </div>
      {props.actions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {props.actions}
        </div>
      )}
      {props.footer}
    </div>
  );
}
