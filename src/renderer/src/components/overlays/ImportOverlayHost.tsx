import type { ReactNode } from "react";
import {
	ClaudeImportModal,
	CodexImportModal,
	OpenCodeImportModal,
} from "../app/ImportModals";
import type {
	ClaudeImportReport,
	ClaudeSessionSummary,
	CodexImportReport,
	CodexSessionSummary,
	OpenCodeImportReport,
	OpenCodeSessionSummary,
	Project,
} from "../../../../shared/types";

type ImportControllerView<TSummary, TReport> = {
	sessions: TSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: TReport | null;
	error: string | null;
	refresh: () => Promise<void>;
	toggle: (sourcePath: string) => void;
	toggleAll: () => void;
	importSelected: () => Promise<TReport | null>;
};

export type ImportOverlayHostProps =
	| { kind: "codex"; project: Project; controller: ImportControllerView<CodexSessionSummary, CodexImportReport>; onClose: () => void }
	| { kind: "claude"; project: Project; controller: ImportControllerView<ClaudeSessionSummary, ClaudeImportReport>; onClose: () => void }
	| { kind: "opencode"; project: Project; controller: ImportControllerView<OpenCodeSessionSummary, OpenCodeImportReport>; onClose: () => void };

function renderImportError(error: string | null): ReactNode {
	return error ? <div className="codex-import-report error" role="alert"><strong>{error}</strong></div> : null;
}

/** A provider switch lives here so Sidebar only chooses a provider/project. */
export function ImportOverlayHost(props: ImportOverlayHostProps) {
	if (props.kind === "codex") return <><CodexImportModal project={props.project} {...props.controller} onClose={props.onClose} onRefresh={props.controller.refresh} onToggle={props.controller.toggle} onToggleAll={props.controller.toggleAll} onImport={() => void props.controller.importSelected()} />{renderImportError(props.controller.error)}</>;
	if (props.kind === "claude") return <><ClaudeImportModal project={props.project} {...props.controller} onClose={props.onClose} onRefresh={props.controller.refresh} onToggle={props.controller.toggle} onToggleAll={props.controller.toggleAll} onImport={() => void props.controller.importSelected()} />{renderImportError(props.controller.error)}</>;
	return <><OpenCodeImportModal project={props.project} {...props.controller} onClose={props.onClose} onRefresh={props.controller.refresh} onToggle={props.controller.toggle} onToggleAll={props.controller.toggleAll} onImport={() => void props.controller.importSelected()} />{renderImportError(props.controller.error)}</>;
}

export type ImportOverlayData = {
	codex: { sessions: CodexSessionSummary[]; report: CodexImportReport | null };
	claude: { sessions: ClaudeSessionSummary[]; report: ClaudeImportReport | null };
	opencode: { sessions: OpenCodeSessionSummary[]; report: OpenCodeImportReport | null };
};
