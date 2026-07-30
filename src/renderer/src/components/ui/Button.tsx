import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as ShadcnButton } from "../ui-shadcn/button";

/**
 * 共享 Button（#115 U5）：API 保持旧版不变，内部换到 shadcn Button。
 * 旧变体映射：primary→default / secondary→secondary / danger→destructive / ghost→ghost。
 * loading 语义保留：禁用 + 行内 spinner，防止提交类操作重复触发。
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANT_MAP = {
	primary: "default",
	secondary: "secondary",
	danger: "destructive",
	ghost: "ghost",
} as const;

export function Button(
	props: ButtonHTMLAttributes<HTMLButtonElement> & {
		variant?: ButtonVariant;
		buttonSize?: ButtonSize;
		loading?: boolean;
		children: ReactNode;
	},
) {
	const {
		variant = "secondary",
		buttonSize = "md",
		loading = false,
		className,
		children,
		type = "button",
		disabled,
		...buttonProps
	} = props;

	return (
		<ShadcnButton
			{...buttonProps}
			type={type}
			variant={VARIANT_MAP[variant]}
			size={buttonSize === "sm" ? "sm" : "default"}
			disabled={disabled || loading}
			className={className}
		>
			{loading && <span className="ui-button-spinner" aria-hidden="true" />}
			<span className={loading ? "opacity-70" : undefined}>{children}</span>
		</ShadcnButton>
	);
}
