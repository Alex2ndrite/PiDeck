import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";
import { t } from "../../i18n";

/**
 * 共享分页控件：上一页 / 页码·总页数 / 下一页。
 * 统一大列表分页的 aria-label、禁用态和尺寸，替换业务面板各自的内联分页。
 */
export function Pagination(props: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { page, totalPages, onPageChange } = props;
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  return (
    <nav
      className={cn("flex items-center justify-center gap-2 py-4", props.className)}
      aria-label={t("pagination.label")}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={prevDisabled}
        aria-label={t("pagination.previous")}
        title={t("pagination.previous")}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeft size={14} />
      </Button>
      <span
        className="text-muted-foreground min-w-14 text-center text-caption tabular-nums"
        aria-live="polite"
      >
        {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={nextDisabled}
        aria-label={t("pagination.next")}
        title={t("pagination.next")}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <ChevronRight size={14} />
      </Button>
    </nav>
  );
}
