import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../ui-shadcn/button";

/**
 * 图标按钮（#115 U5）：API 不变，内部为 shadcn ghost icon Button。
 * label 同时承担 aria-label 与原生 title 提示（轻量场景不引入 Tooltip）。
 */
export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	children: ReactNode;
}) {
	const {
		children,
		className,
		label,
		title,
		type = "button",
		...buttonProps
	} = props;
	return (
		<Button
			{...buttonProps}
			type={type}
			variant="ghost"
			size="icon"
			className={className}
			aria-label={label}
			title={title ?? label}
		>
			{children}
		</Button>
	);
}

export function CloseIconButton(props: {
	label: string;
	onClick?: () => void;
	className?: string;
}) {
	return (
		<IconButton
			className={["modal-close-btn", props.className].filter(Boolean).join(" ")}
			label={props.label}
			onClick={props.onClick}
		>
			<X size={18} strokeWidth={2.2} aria-hidden="true" />
		</IconButton>
	);
}
