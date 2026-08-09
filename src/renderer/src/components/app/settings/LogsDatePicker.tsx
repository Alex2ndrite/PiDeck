import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { zhCN } from "date-fns/locale/zh-CN";
import { enUS } from "date-fns/locale/en-US";
import { Calendar } from "../../ui-shadcn/calendar";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui-shadcn/popover";
import { getI18nLocale, t } from "../../../i18n";

/**
 * 日志"筛选时间"选择器：shadcn Calendar 选日期 + 时间输入，替代原生 datetime-local。
 * - 未选日期：按钮只显示短占位（"筛选时间"），不会用整句说明撑宽按钮；
 * - 已选日期：按钮显示 "2026/8/9 00:00"，时间输入与清除按钮才出现（避免空框误看为多余控件）；
 * - value 格式与 datetime-local 保持一致（"YYYY-MM-DDTHH:mm"），
 *   上层 query.from = new Date(from).getTime() 无需改动。
 */

/** 解析日期部分为本地时区 Date（不能用 new Date("YYYY-MM-DD")——按 UTC 零点解析会偏移一天）。 */
function parseDatePart(value: string): Date | undefined {
	const [year, month, day] = value.slice(0, 10).split("-").map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

/** 按本地时区拼回 "YYYY-MM-DDTHH:mm"；时间未选时默认 00:00。 */
function formatValue(date: Date, time: string): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}T${time || "00:00"}`;
}

export function LogsDatePicker(props: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	clearLabel: string;
}) {
	const [open, setOpen] = useState(false);
	const date = parseDatePart(props.value);
	const time = props.value.includes("T") ? props.value.slice(11, 16) : "";
	// pseudo locale 走 en-US，与 formatI18nDateTime 的处理一致
	const locale = getI18nLocale() === "zh-CN" ? zhCN : enUS;
	const dateLabel = date
		? `${date.toLocaleDateString(locale.code === "zh-CN" ? "zh-CN" : "en-US")} ${time || "00:00"}`
		: t("logs.sinceShort");

	return (
		<div className="flex items-center gap-1.5">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="justify-start font-normal"
						title={props.placeholder}
						aria-label={props.placeholder}
					>
						<CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
						<span className="truncate">{dateLabel}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[288px] p-0" align="start">
					<Calendar
						mode="single"
						locale={locale}
						selected={date}
						// 固定宽度：默认 w-fit 在窄弹层下表头前后翻月按钮会与内容重叠
						classNames={{ root: "w-full" }}
						// 选中日期后保留已填时间，未填默认 00:00；保持弹出层开启便于连续调整
						onSelect={(next) => {
							if (next) props.onChange(formatValue(next, time));
						}}
					/>
				</PopoverContent>
			</Popover>
			{/* 时间输入仅在已选日期后显示：无日期时留一个空框会误看为多余控件 */}
			{date && (
				<Input
					type="time"
					className="w-[110px] shrink-0"
					value={time}
					onChange={(event) => {
						// 尚未选日期时以今天为基准
						const base = date ?? new Date();
						props.onChange(formatValue(base, event.target.value));
					}}
					aria-label={props.placeholder}
				/>
			)}
			{props.value && (
				<Button
					variant="ghost"
					size="sm"
					className="shrink-0"
					onClick={() => props.onChange("")}
					title={props.clearLabel}
					aria-label={props.clearLabel}
				>
					{t("common.clear")}
				</Button>
			)}
		</div>
	);
}
