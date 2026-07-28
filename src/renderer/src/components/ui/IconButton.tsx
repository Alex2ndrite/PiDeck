import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";

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
		<button
			{...buttonProps}
			type={type}
			className={["ui-icon-button", className].filter(Boolean).join(" ")}
			aria-label={label}
			title={title ?? label}
		>
			{children}
		</button>
	);
}

export function CloseIconButton(props: {
	label: string;
	onClick: () => void;
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
