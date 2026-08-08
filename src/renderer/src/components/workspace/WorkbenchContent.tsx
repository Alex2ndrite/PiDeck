import { lazy, Suspense } from "react";
import type { WorkspaceContentOpenMode } from "../../../../shared/types";
import { t } from "../../i18n";

const FileDiffViewer = lazy(() =>
	import("../app/FileDiffViewer").then((m) => ({ default: m.FileDiffViewer })),
);

type EditorTabLike = {
	id: string;
	filePath: string;
	mode: "view" | "diff";
	originalContent: string;
	modifiedContent?: string;
	allowSave: boolean;
	label?: string;
	preserveDrawer?: boolean;
};

type GitDiffLike = {
	filePath: string;
	originalContent: string;
	modifiedContent: string;
	label: string;
};

export type WorkbenchContentProps = {
	theme: "dark" | "light";
	maxFileSizeMB: number;
	/** Git Diff 优先；无 Diff 时渲染编辑器 tab */
	gitDiff: GitDiffLike | null;
	gitDiffDisplayMode: WorkspaceContentOpenMode;
	onToggleGitDiffMode: () => void;
	onCloseGitDiff: () => void;
	activeTab: EditorTabLike | null;
	editorTabs: EditorTabLike[];
	activeTabId: string | null;
	editorMode: WorkspaceContentOpenMode;
	onToggleEditorMode?: () => void;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
	onCloseEditor: () => void;
	readContent: (path: string) => Promise<string>;
	readOriginalContent: (path: string) => Promise<string>;
	saveContent: (path: string, content: string) => Promise<void>;
};

function WorkbenchContentFallback() {
	return (
		<div className="file-diff-loading flex h-full items-center justify-center text-caption text-muted-foreground">
			{t("drawer.lazyLoading")}
		</div>
	);
}

/**
 * 中间栏阅读面：Git Diff / 文件编辑共用 FileDiffViewer。
 * FileDiffViewer（含 CodeMirror）按需 lazy，首屏不背编辑器包；
 * 路径错误导致动态 import 失败的问题已在 WorkbenchStage 修好，可安全恢复 lazy。
 */
export function WorkbenchContent(props: WorkbenchContentProps) {
	if (props.gitDiff) {
		return (
			<Suspense fallback={<WorkbenchContentFallback />}>
				<FileDiffViewer
					displayMode={props.gitDiffDisplayMode}
					filePath={props.gitDiff.filePath}
					mode="diff"
					onToggleMode={props.onToggleGitDiffMode}
					originalContent={props.gitDiff.originalContent}
					modifiedContent={props.gitDiff.modifiedContent}
					tabs={[
						{
							id: props.gitDiff.filePath,
							filePath: props.gitDiff.filePath,
							label: props.gitDiff.label,
						},
					]}
					activeTabId={props.gitDiff.filePath}
					onClose={props.onCloseGitDiff}
					readContent={props.readContent}
					theme={props.theme}
					maxFileSizeMB={props.maxFileSizeMB}
				/>
			</Suspense>
		);
	}

	if (!props.activeTab) return null;

	return (
		<Suspense fallback={<WorkbenchContentFallback />}>
			<FileDiffViewer
				displayMode={props.editorMode}
				filePath={props.activeTab.filePath}
				mode={props.activeTab.mode}
				onToggleMode={
					props.activeTab.preserveDrawer ? undefined : props.onToggleEditorMode
				}
				originalContent={
					props.activeTab.mode === "diff"
						? props.activeTab.originalContent
						: undefined
				}
				modifiedContent={props.activeTab.modifiedContent}
				tabs={props.editorTabs.map((tab) => ({
					id: tab.id,
					filePath: tab.filePath,
					label: tab.label,
				}))}
				activeTabId={props.activeTabId}
				onSelectTab={props.onSelectTab}
				onCloseTab={props.onCloseTab}
				onClose={props.onCloseEditor}
				readContent={props.readContent}
				readOriginalContent={props.readOriginalContent}
				saveContent={
					props.activeTab.allowSave ? props.saveContent : undefined
				}
				theme={props.theme}
				maxFileSizeMB={props.maxFileSizeMB}
			/>
		</Suspense>
	);
}
