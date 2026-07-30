import type { KeyboardEventHandler, ReactNode } from "react";
import { Input } from "../ui-shadcn/input";

/**
 * 文本输入字段（#115 U5）：API 不变，内部换成 shadcn Input。
 */
export function TextField(props: {
	label: ReactNode;
	value: string;
	onChange: (value: string) => void;
	className?: string;
	description?: ReactNode;
	placeholder?: string;
	disabled?: boolean;
	type?: "text" | "number" | "password";
	min?: number;
	max?: number;
	onBlur?: () => void;
	onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
	return (
		<label className={["ui-field", props.className].filter(Boolean).join(" ")}>
			<span className="ui-field-label">{props.label}</span>
			<Input
				type={props.type ?? "text"}
				value={props.value}
				placeholder={props.placeholder}
				disabled={props.disabled}
				min={props.min}
				max={props.max}
				onChange={(event) => props.onChange(event.target.value)}
				onBlur={props.onBlur}
				onKeyDown={props.onKeyDown}
			/>
			{props.description && (
				<small className="ui-field-description">{props.description}</small>
			)}
		</label>
	);
}
