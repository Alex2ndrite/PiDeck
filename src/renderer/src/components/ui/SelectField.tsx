import type { ReactNode } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui-shadcn/select";

export type SelectFieldOption = {
	value: string;
	label: ReactNode;
	disabled?: boolean;
};

/**
 * 下拉选择字段（#115 U5）：API 不变，内部换成 shadcn Select（Radix）。
 * 原来手写的外点关闭/ESC/展开态管理全部删除，交给 Radix。
 * 注意：SelectItem 的文本内容来自 option.label；label 为复合 ReactNode 时
 * trigger 回显由 SelectValue 内部取选中项内容，行为与旧版一致。
 */
export function SelectField(props: {
	label: ReactNode;
	value: string;
	options: SelectFieldOption[];
	onChange: (value: string) => void;
	className?: string;
	description?: ReactNode;
	disabled?: boolean;
}) {
	return (
		<div className={["grid gap-1.5", props.className].filter(Boolean).join(" ")}>
			<span className="text-sm font-medium leading-none text-foreground">{props.label}</span>
			<Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{props.options.map((option) => (
						<SelectItem key={option.value} value={option.value} disabled={option.disabled}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{props.description && (
				<small className="text-xs text-muted-foreground">{props.description}</small>
			)}
		</div>
	);
}
