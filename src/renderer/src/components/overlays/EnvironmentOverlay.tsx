import type { ComponentProps } from "react";
import { EnvironmentDialog } from "../app/AppParts";

export type EnvironmentOverlayProps = {
	open: boolean;
	dialog: ComponentProps<typeof EnvironmentDialog>;
};

/** Root boundary for environment detection; the existing dialog remains a presentational leaf. */
export function EnvironmentOverlay({ open, dialog }: EnvironmentOverlayProps) {
	return open ? <EnvironmentDialog {...dialog} /> : null;
}
