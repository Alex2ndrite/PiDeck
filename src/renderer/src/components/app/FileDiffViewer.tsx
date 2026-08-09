import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { ArrowLeft, Edit3, Maximize, Minimize2, PencilOff, SquareSplitHorizontal, X, Eye, FileCode } from "lucide-react";
import { Button } from "../ui-shadcn/button";
import { cn } from "../../lib/utils";
import { MarkdownStream } from "../session/MarkdownStream";
import { defaultUrlTransform } from "../session/MarkdownLinkCore";
import { defaultRemarkPlugins, defaultRehypePlugins } from "streamdown";
import rehypeKatex from "rehype-katex";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { MergeDiffView } from "./MergeDiffView";
import { formatFilePathRef } from "../session/composer/chips";

import { isBinaryExtension, isImageFile, isPdfFile } from "../../utils/isTextFile";

type ViewMode = "view" | "diff";

export function FileDiffViewer(props: {
	filePath: string;
	mode?: ViewMode;
	/** 展示模式：drawer=窄抽屉；split/maximize=中间栏宿主；modal=遗留全屏弹层 */
	displayMode?: "modal" | "drawer" | "split" | "maximize";
	/** 在分屏 / 占满中间栏之间切换（中间栏宿主）；遗留 drawer↔modal 也走此回调 */
	onToggleMode?: () => void;
	/** 返回按钮回调（侧栏模式时提供，点击返回上一面板） */
	onBack?: () => void;
	onClose: () => void;
	/** 多 tab 支持：全部 tab 列表（≥1 时顶栏始终展示，与 VS Code 一致） */
	tabs?: { id: string; filePath: string; label?: string; preview?: boolean }[];
	/** 当前活跃 tab ID */
	activeTabId?: string | null;
	/** 切换到指定 tab */
	onSelectTab?: (id: string) => void;
	/** 关闭指定 tab */
	onCloseTab?: (id: string) => void;
	/** 双击预览 Tab → 常驻 */
	onPromotePreviewTab?: (id: string) => void;
	readContent: (path: string) => Promise<string>;
	/** 从会话消息 meta 中提取的工具执行前原始内容，优先于 Git HEAD。 */
	originalContent?: string;
	/** Session-recorded modified content, preferred over disk read for historical sessions. */
	modifiedContent?: string;
	/** 读取文件的 Git HEAD 原始内容，供差异模式左侧基准列使用。 */
	readOriginalContent?: (path: string) => Promise<string>;
	saveContent?: (path: string, content: string) => Promise<void>;
	/** HTML 文件点击预览时，切换到内置浏览器面板预览。 */
	onPreviewHtml?: (filePath: string) => void;
	theme?: "light" | "dark";
	/** 单个文件超过此大小（MB）时不加载编辑器。默认 5MB。 */
	maxFileSizeMB?: number;
	/**
	 * Tab 已上收到 SessionTabsBar 时为 true：不再渲染内容区内嵌 Tab 栏/重复文件名，
	 * 只保留右侧动作钮（预览/分屏/关闭）。
	 */
	chromeTabsExternal?: boolean;
}) {
	const maxFileSize = (props.maxFileSizeMB ?? 5) * 1024 * 1024;
	const [content, setContent] = useState("");
	// 差异模式左侧展示的原始内容：优先使用会话缓存（originalContent），
	// 没有则从 Git HEAD 读取。新增/未跟踪文件为空字符串。
	const [original, setOriginal] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sideBySide, setSideBySide] = useState(props.displayMode !== "drawer");
	// 默认编辑模式：view 模式打开即可编辑（不再需要先点「编辑」）；
	// diff 模式保持只读（历史提交/工作区对比场景，避免误改，需要时仍可点编辑进入）。
	const [readOnly, setReadOnly] = useState(() => props.mode === "diff");
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [showHint, setShowHint] = useState(false);
	// 二进制预览（图片/PDF）的 Blob URL：切换文件/卸载时 revoke，防止内存泄漏
	const [mediaUrl, setMediaUrl] = useState<string | null>(null);
	const mediaUrlRef = useRef<string | null>(null);

	const isDiffMode = props.mode === "diff";
	const fileName = props.filePath.split(/[/\\]/).pop() ?? props.filePath;
	const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
	const isMarkdown = ext === "md" || ext === "mdx";
	const isHtml = ext === "html" || ext === "htm";
	// SVG 是文本（可编辑），预览时用内容渲染为 data URL 图片（CSP img-src 已允许 data:）
	const isSvg = ext === "svg";
	// 图片/PDF 走内置预览（view 模式）：二进制内容不可文本读取，跳过编辑器直接渲染。
	const isImage = isImageFile(props.filePath);
	const isPdf = isPdfFile(props.filePath);
	// 默认预览模式：markdown/html/svg 打开直接渲染预览（干净阅读），
	// 点「源码」切换按钮才进入源码模式；源码模式即编辑模式，不再需要独立的编辑按钮。
	const defaultPreview = !isDiffMode && (isMarkdown || isHtml || isSvg);
	const [preview, setPreview] = useState(defaultPreview);

	useEffect(() => {
		// 每个 tab 重置编辑状态：view 默认可编辑，diff 只读（避免把编辑状态带入历史提交 Diff）。
		setReadOnly(isDiffMode);
		setDirty(false);
		setShowHint(false);
		setPreview(defaultPreview);
		// 清掉上一个文件的 Blob URL（媒体预览随 tab 切换失效）
		revokeMediaUrl();
		setMediaUrl(null);
	}, [isDiffMode, props.activeTabId, props.filePath]);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			setLoading(true);
			setError(null);
			setDirty(false);
			try {
				// 图片/PDF：仅 view 模式读取二进制转 Blob URL 预览（不文本读取）；
				// diff 模式无法展示二进制差异，维持「不支持编辑」提示。
				if (isBinaryExtension(props.filePath)) {
					if (!isDiffMode && (isImageFile(props.filePath) || isPdfFile(props.filePath))) {
						await loadMediaPreview(cancelled);
						return;
					}
					setError(t("editor.binaryFileNotSupported", { ext }));
					setLoading(false);
					return;
				}
				// 差异模式优先使用会话缓存原始内容（originalContent），
				// 没有时降级到 Git HEAD；两者都无则左侧显示空（新增文件）。
				// 修改后内容优先使用会话记录（modifiedContent），历史会话恢复时磁盘可能已变化。
				const contentPromise = props.modifiedContent !== undefined
					? Promise.resolve(props.modifiedContent)
					: props.readContent(props.filePath);
				const originalPromise =
					isDiffMode && props.originalContent !== undefined
						? Promise.resolve(props.originalContent)
						: isDiffMode && props.readOriginalContent
							? props.readOriginalContent(props.filePath).catch(() => "")
							: Promise.resolve("");
				const [result, originalResult] = await Promise.all([
					contentPromise,
					originalPromise,
				]);
				if (!cancelled) {
					const largestContentSize = Math.max(result.length, originalResult.length);
					// Diff 任一侧超过上限都不加载编辑器；删除文件虽右侧为空，左侧仍可能很大。
					if (largestContentSize > maxFileSize) {
						setError(
							t("editor.fileTooLarge", {
								size: (largestContentSize / 1024 / 1024).toFixed(1),
								max: (maxFileSize / 1024 / 1024).toFixed(0),
							}),
						);
						setLoading(false);
						return;
					}
					setContent(result);
					// 自动保存基准快照：加载完成即视为「已落盘」状态，避免打开后无改动就触发写盘
					lastSavedRef.current = result;
					setOriginal(originalResult);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		// 二进制预览加载：主进程读 base64 → Blob URL。
		// 为什么不用 file:// 直链：dev 模式页面走 http:// 加载，Chromium webSecurity
		// 会以 "Not allowed to load local resource" 拦截 file:// 子资源；
		// blob: 与 CSP（img-src/frame-src 均允许 blob:）匹配且 dev/prod 行为一致。
		async function loadMediaPreview(isCancelled: boolean) {
			const readBinary = window.piDesktop?.files?.readBase64;
			if (!readBinary) {
				if (!isCancelled) setError(t("editor.binaryFileNotSupported", { ext }));
				return;
			}
			try {
				const base64 = await readBinary(props.filePath);
				if (isCancelled || !base64) {
					if (!isCancelled) setError(t("editor.binaryFileNotSupported", { ext }));
					return;
				}
				const mime = isPdf ? "application/pdf" : mimeFromImageExt(ext);
				const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
				revokeMediaUrl();
				const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
				mediaUrlRef.current = url;
				setMediaUrl(url);
			} catch (e) {
				if (!isCancelled) setError(e instanceof Error ? e.message : String(e));
			}
		}
		void load();
		return () => { cancelled = true; };
	// readContent/readOriginalContent 是稳定的 API 回调（上层已 useCallback），
	// 不参与 effect deps，避免父组件因其他状态变化重渲染时反复加载文件导致编辑器重置到顶部。
	// 两侧缓存内容都需要监听：同一路径可在多个历史提交 Diff tab 之间切换。
	}, [props.filePath, props.originalContent, props.modifiedContent, isDiffMode]);

	const handleClose = useCallback(() => {
		props.onClose();
	}, [props.onClose]);

	// 释放媒体预览 Blob URL（组件内声明：依赖 mediaUrlRef）
	function revokeMediaUrl() {
		if (mediaUrlRef.current) {
			URL.revokeObjectURL(mediaUrlRef.current);
			mediaUrlRef.current = null;
		}
	}

	// 从当前内容 state 取最新值（编辑器 onChange 已实时同步；CM6 无 Monaco 的实例取值路径）
	const getLatestContent = useCallback(() => content, [content]);

	// 自动保存：编辑停止 500ms 后静默落盘（仅 allowSave 的文件），Ctrl+S 立即保存并取消挂起的自动保存。
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// 最近一次落盘内容快照：内容未变时跳过保存，避免重复写盘
	const lastSavedRef = useRef("");

	const saveNow = useCallback(async () => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		if (!props.saveContent) return;
		const latest = getLatestContent();
		if (latest === lastSavedRef.current) return;
		setSaving(true);
		try {
			await props.saveContent(props.filePath, latest);
			lastSavedRef.current = latest;
			setContent(latest);
			setDirty(false);
		} catch (e) {
			// 保存失败保留 dirty，用户可继续编辑后由下一次自动保存/Ctrl+S 重试
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}, [getLatestContent, props.saveContent, props.filePath]);

	const scheduleAutoSave = useCallback(() => {
		if (!props.saveContent) return;
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveTimerRef.current = null;
			void saveNow();
		}, 500);
	}, [props.saveContent, saveNow]);

	// Ctrl+S / Cmd+S：立即保存（取消挂起的自动保存，避免重复写盘）
	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "s") {
			e.preventDefault();
			void saveNow();
		}
	}, [saveNow]);

	useEffect(() => {
		if (!readOnly) {
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}
	}, [readOnly, handleKeyDown]);

	// 卸载时取消挂起的自动保存 timer + 释放媒体 Blob URL（生命周期配对）
	useEffect(() => {
		return () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
			}
			revokeMediaUrl();
		};
	}, []);

	// 进入编辑时显示快捷键提示，3 秒后自动消失
	useEffect(() => {
		if (showHint) {
			const timer = setTimeout(() => setShowHint(false), 3000);
			return () => clearTimeout(timer);
		}
	}, [showHint]);

	const handleEditToggle = useCallback(() => {
		setReadOnly(false);
		setShowHint(true);
	}, []);

	const handleExitEdit = useCallback(() => {
		setReadOnly(true);
	}, []);

	const handleEditorChange = useCallback((value: string) => {
		setContent(value);
		setDirty(true);
		scheduleAutoSave();
	}, [scheduleAutoSave]);

	// 编辑器选中文本 → 右键「引用选中内容」：以 pi 的 read 语法 @path:start-end 派发到输入框。
	// 与文件树右键 onAttach 共用同一追加语义（composer-attach-refs 由 App 监听后插入 draft）。
	const handleAttachSelection = useCallback((startLine: number, endLine: number) => {
		const range = startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
		const ref = `${formatFilePathRef(props.filePath)}:${range}`;
		window.dispatchEvent(new CustomEvent("composer-attach-refs", { detail: { refs: [ref] } }));
	}, [props.filePath]);

	const language = ext;

	const displayMode = props.displayMode ?? "drawer";
	const isWorkbenchPane = displayMode === "split" || displayMode === "maximize";
	const showInlineTabs =
		!props.chromeTabsExternal && Boolean(props.tabs && props.tabs.length > 0);
	const headerContent = (
		<>
			{showInlineTabs && props.tabs && (
				<div className="file-diff-tab-bar" role="tablist">
					{props.tabs.map((tab) => {
						const tabLabel =
							tab.label ?? tab.filePath.split(/[/\\]/).pop() ?? tab.filePath;
						const showDirty =
							tab.id === props.activeTabId && dirty
								? t("editor.unsavedMarker")
								: "";
						return (
							<div
								key={tab.id}
								role="tab"
								aria-selected={tab.id === props.activeTabId}
								className={cn(
									"file-diff-tab",
									tab.id === props.activeTabId && "active",
									tab.preview && "italic text-muted-foreground",
								)}
								onClick={() => props.onSelectTab?.(tab.id)}
								onDoubleClick={() => props.onPromotePreviewTab?.(tab.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										props.onSelectTab?.(tab.id);
									}
								}}
								title={tab.label ?? tab.filePath}
								tabIndex={0}
							>
								<span>
									{tabLabel}
									{showDirty}
								</span>
								<button
									type="button"
									className="file-diff-tab-close"
									onClick={(e) => {
										e.stopPropagation();
										props.onCloseTab?.(tab.id);
									}}
									aria-label={t("common.close")}
								>
									<X size={11} />
								</button>
							</div>
						);
					})}
				</div>
			)}
			<div className="file-diff-header">
				{props.onBack && displayMode === "drawer" && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="file-diff-close"
						onClick={props.onBack}
						title={t("common.back")}
						aria-label={t("common.back")}
					>
						<ArrowLeft size={18} />
					</Button>
				)}
				{/* 外置 chrome / 内嵌 Tab：文件名已在 Tab 上，标题槽只留脏标提示 */}
				{props.chromeTabsExternal || showInlineTabs ? (
					<span className="file-diff-title min-w-0 flex-1 truncate">
						{dirty && !props.chromeTabsExternal && t("editor.unsavedMarker")}
						{showHint && (
							<span className="file-diff-hint">{t("app.saveFileShortcut")}</span>
						)}
					</span>
				) : (
					<span className="file-diff-title" title={props.filePath}>
						{fileName}
						{dirty && t("editor.unsavedMarker")}
						{showHint && (
							<span className="file-diff-hint">{t("app.saveFileShortcut")}</span>
						)}
					</span>
				)}
				<div className="file-diff-header-actions">
					{(isMarkdown || isHtml || isSvg) && !isDiffMode && !loading && !error && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="file-diff-toggle-btn"
							title={preview ? t("editor.source") : t("editor.preview")}
							onClick={() => {
								if (isHtml && props.onPreviewHtml) {
									props.onPreviewHtml(props.filePath);
								} else {
									setPreview(!preview);
								}
							}}
						>
							{preview ? <FileCode size={15} /> : <Eye size={15} />}
						</Button>
					)}
					{isDiffMode && !loading && !error && displayMode !== "drawer" && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="file-diff-toggle-btn"
							title={sideBySide ? t("app.showSingle") : t("app.showSplit")}
							onClick={() => setSideBySide(!sideBySide)}
						>
							<SquareSplitHorizontal size={15} />
						</Button>
					)}
					{/* 编辑/退出编辑按钮仅保留给 diff 模式（历史对比默认只读，需要时点编辑进入）；
					   view 模式源码即编辑：切到源码即可改，无需独立的编辑按钮。 */}
					{isDiffMode && props.saveContent && readOnly && !preview && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="file-diff-toggle-btn"
							title={t("app.editFile")}
							onClick={handleEditToggle}
						>
							<Edit3 size={15} />
						</Button>
					)}
					{isDiffMode && !readOnly && props.saveContent && !preview && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="file-diff-toggle-btn"
							title={t("app.exitEdit")}
							onClick={handleExitEdit}
						>
							{/* 退出编辑≠关闭文件：不用 X，避免与 Tab/阅读面关闭叉混淆 */}
							<PencilOff size={15} />
						</Button>
					)}
					{props.onToggleMode && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="file-diff-toggle-btn"
							title={
								isWorkbenchPane
									? displayMode === "maximize"
										? t("app.restoreSplit")
										: t("app.maximizeInWorkbench")
									: displayMode === "modal"
										? t("app.minimizeToDrawer")
										: t("app.expandToModal")
							}
							onClick={props.onToggleMode}
						>
							{(isWorkbenchPane ? displayMode === "maximize" : displayMode === "modal")
								? <Minimize2 size={15} />
								: <Maximize size={15} />}
						</Button>
					)}
					{/* 关闭按钮：无论 Tab 是否上收总栏都保留，保证 DIFF/文件预览右上角
					   始终有关闭入口（Tab 栏小叉在窄栏下不易点中）。与「退出编辑」（PencilOff）
					   语义不同：X 关闭整个阅读面，PencilOff 仅退出编辑态。 */}
					<Button
						variant="ghost"
						size="icon-sm"
						className="file-diff-toggle-btn"
						onClick={handleClose}
						aria-label={t("common.close")}
						title={t("common.close")}
					>
						<X size={15} />
					</Button>
				</div>
			</div>
			<div className="file-diff-body">
				{loading && <div className="file-diff-loading">{t("common.loading")}</div>}
				{error && <div className="file-diff-error">{error}</div>}
				{!loading && !error && (
					<>
						{/* 图片预览：Blob URL（base64 经主进程读取，dev/prod 一致） */}
						{!isDiffMode && isImage && mediaUrl && (
							<div className="file-diff-media-preview">
								<img src={mediaUrl} alt={fileName} />
							</div>
						)}
						{/* PDF 预览：Blob URL + Chromium 内置 PDF viewer */}
						{!isDiffMode && isPdf && mediaUrl && (
							<iframe
								className="file-diff-pdf-preview"
								src={mediaUrl}
								title={t("editor.pdfPreview")}
								referrerPolicy="no-referrer"
							/>
						)}
						{/* SVG 预览：文本内容直接编码为 data URL（无 Blob 生命周期管理） */}
						{!isDiffMode && preview && isSvg && (
							<div className="file-diff-media-preview">
								<img
									src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
									alt={fileName}
								/>
							</div>
						)}
						{/* Markdown 预览：仅 view 模式且 preview 启用（静态渲染，与会话正文同一 Streamdown 引擎） */}
						{!isDiffMode && preview && isMarkdown && (
							<div className="file-diff-preview">
								<MarkdownStream
									text={content}
									onOpenExternal={() => undefined}
									remarkPlugins={[defaultRemarkPlugins.gfm]}
									rehypePlugins={[defaultRehypePlugins.raw, rehypeKatex]}
									urlTransform={defaultUrlTransform}
								/>
							</div>
						)}
						{!isDiffMode && preview && isHtml && (
							<HtmlPreview content={content} />
						)}
						{/* view 模式、非预览：常规编辑器（CodeMirror 6） */}
						{!isDiffMode && !preview && (
							<div style={{ height: "100%", flexDirection: "column" }}>
								<CodeMirrorEditor
									value={content}
									language={language}
									readOnly={readOnly}
									onChange={handleEditorChange}
									onAttachSelection={handleAttachSelection}
								/>
							</div>
						)}
						{/* diff 模式：MergeView（分栏）/ unifiedMergeView（单栏），
							与 Editor 不同时渲染，key 切换强制重建避免状态串台 */}
						{isDiffMode && (
							<div style={{ height: "100%", flexDirection: "column" }}>
								<MergeDiffView
									key={sideBySide ? "split" : "unified"}
									original={original}
									modified={content}
									language={language}
									readOnly={readOnly}
									sideBySide={sideBySide}
									onChange={handleEditorChange}
								/>
							</div>
						)}
					</>
				)}
			</div>
		</>
	);

	if (displayMode === "modal") {
		return (
			<div className="modal-backdrop" onClick={readOnly ? handleClose : undefined}>
				<div className="file-diff-modal" onClick={(e) => e.stopPropagation()}>
					{headerContent}
				</div>
			</div>
		);
	}

	return (
		<div className="file-diff-viewer">
			{headerContent}
		</div>
	);
}

/**
 * HTML previews intentionally use an opaque-origin iframe. This restores the
 * dev preview interaction without giving project HTML the renderer's origin,
 * Electron bridge, popups, or file-system navigation privileges.
 */
/** 图片扩展名 → MIME（Blob 类型；Chromium 按内容解码，类型仅作提示） */
function mimeFromImageExt(ext: string): string {
	const map: Record<string, string> = {
		png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
		webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
	};
	return map[ext] ?? "application/octet-stream";
}

function HtmlPreview({ content }: { content: string }) {
	return (
		<iframe
			className="file-diff-preview"
			srcDoc={content}
			title={t("editor.htmlPreview")}
			sandbox="allow-scripts allow-forms"
			referrerPolicy="no-referrer"
			style={{ width: "100%", height: "100%", border: "none" }}
		/>
	);
}
