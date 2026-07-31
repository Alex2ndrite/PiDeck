// ============================================================
// AppParts — 产品级顶层桥接文件
// ============================================================
// 本文件保留：
//   1. Overlay domain (EnvironmentDialog, ConfirmDialog)
//   2. 全局类型定义 (SessionModifiedFile, DiffFileHandler)
//   3. Re-exports from leaf modules (Composer, Sidebar, Surface)
// ============================================================

import { t } from "../../i18n";
import { Modal } from "../ui/Modal";
import { ConfirmDialog as ShadcnConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import type { PiInstallStatus, PiInstallExecResult } from "../../../../shared/types";

// Re-exports from other modules
export type { WorkspaceDrawerPanel as DrawerPanel } from "../../hooks/useWorkspacePanels";

// Re-exports from leaf modules (A12 migration in progress)
import { PiLogoCanvas } from "./PiLogoCanvas";
export { WorktreeCreateDialog } from "../sidebar/SidebarComponents";
export { ComposerBottomBar, ModelPicker, PromptTemplatePicker, ThinkingPicker, ComposerModePicker, ExtensionWidgetCard } from "../session/ComposerComponents";

export type SessionModifiedFile = {
	path: string;
	toolName: string;
	status: string;
	changedLines?: number;
	/** 工具执行前的文件原始内容，用于历史会话恢复时展示差异对比。 */
	originalContent?: string;
	/** 工具写入/编辑后的新文件内容，优先于从磁盘实时读取（历史会话恢复时磁盘可能已变化或文件已删除）。 */
	content?: string;
};

type DiffFileHandler = (path: string, originalContent?: string, content?: string) => void;

export function EnvironmentDialog(props: {
	status: PiInstallStatus | null;
	checking: boolean;
	onClose: () => void;
	onRecheck: () => void;
	onOpenInstallDocs: () => void;
	/** 用户手动输入的 pi 路径 */
	customPath: string;
	/** 正在校验自定义路径 */
	customPathValidating: boolean;
	/** 自定义路径校验结果 */
	customPathResult: PiInstallStatus | null;
	onCustomPathChange: (path: string) => void;
	onValidateCustomPath: () => void;
	/** npm 可用性 */
	npmAvailable: boolean | null;
	npmVersion?: string;
	npmChecking: boolean;
	/** 当前安装命令文本 */
	installCommand: string;
	/** 是否使用国内镜像源 */
	installUseMirror: boolean;
	/** 是否正在执行安装 */
	installExecuting: boolean;
	/** 安装执行结果 */
	installResult: PiInstallExecResult | null;
	/** 安装是否已成功完成 */
	installCompleted: boolean;
	onCheckNpm: () => void;
	onInstallCommandChange: (cmd: string) => void;
	onToggleInstallMirror: () => void;
	onExecInstall: () => void;
	onRestartApp: () => void;
	/** 重置 piEnvironmentChecked 标记，使下次启动重新触发环境检测 */
	onClearCheckFlag?: () => void;
}) {
	const installed = props.status?.installed || props.customPathResult?.installed;
	const searchedDirs = props.status?.searchedDirs.slice(0, 16) ?? [];
	const errorText = props.status?.error ?? props.customPathResult?.error;
	const steps = [
		t("environment.stepInstall"),
		t("environment.stepPath"),
		t("environment.stepPermission"),
		t("environment.stepDone"),
	];
	const activeStep = props.checking ? 0 : installed ? 3 : 1;

	// Windows 统一使用 CMD 查找 .cmd/.exe shim，不再引导用户使用 PowerShell 的 .ps1 入口。
	const refCmd = 'where pi';

	return (
		<Modal
			open={true}
			onClose={props.onClose}
			title={t("environment.title")}
			size="medium"
		>
			<div className="environment-body">
					<div className="env-stepper" aria-label={t("environment.title")}>
						{steps.map((step, index) => (
							<div
								key={step}
								className={`env-step ${index < activeStep ? "done" : ""} ${index === activeStep ? "active" : ""}`}
							>
								<span>{index < activeStep ? "✓" : index + 1}</span>
								<b>{step}</b>
							</div>
						))}
					</div>

					{props.checking && (
						<div className="env-card env-loading-card">
							<div className="loader" />
							<span>{t("environment.checking")}</span>
						</div>
					)}

					{!props.checking && installed && (
						<div className="env-card env-success-card">
							<div className="env-success-icon">✓</div>
							<div className="env-success-info">
								<strong>{t("environment.passed")}</strong>
								<span>
									{t("environment.path")}：{(props.customPathResult || props.status)?.command}
								</span>
								{(props.customPathResult || props.status)?.version && (
									<span>
										{t("environment.version")}：{(props.customPathResult || props.status)!.version}
									</span>
								)}
								<small>{t("environment.autoClose")}</small>
							</div>
						</div>
					)}

					{!props.checking && !installed && (
						<>
							{/* 状态说明卡片 */}
							<div className="env-card env-status-card">
								<strong>{t("environment.notFoundTitle")}</strong>
								<small>{t("environment.notFoundDesc")}</small>
							</div>

							{/* 自动检测错误信息（如有） */}
							{errorText && (
								<div className="env-card env-error-card">
									<strong>{t("environment.errorDetails")}</strong>
									<pre className="env-error-pre">{errorText}</pre>
								</div>
							)}

							{/* npm 安装 pi 卡片（合并了安装指引） */}
							<div className="env-card env-npm-install-card">
								<strong>{t("environment.installCardTitle")}</strong>
								<small>{t("environment.installCardDesc")}</small>
								<small>
									{t("environment.installDesc")}{" "}
									<a
										className="env-inline-link"
										href="#"
										onClick={(e) => {
											e.preventDefault();
											props.onOpenInstallDocs();
										}}
									>
										{t("environment.openInstallDocs")}
									</a>
								</small>

								{/* npm 可用性检测 */}
								{props.npmAvailable === null && !props.npmChecking && (
									<button
										className="env-card-btn"
										onClick={props.onCheckNpm}
									>
										{t("environment.stepInstall")}
									</button>
								)}

								{props.npmChecking && (
									<div className="env-install-loading">
										<div className="loader" />
										<span>{t("environment.checking")}</span>
									</div>
								)}

								{/* npm 可用时：显示安装命令和操作 */}
								{props.npmAvailable === true && !props.npmChecking && (
									<div className="env-install-area">
										{props.npmVersion && (
											<div className="env-install-npm-version">
												npm {props.npmVersion}
											</div>
										)}
										<div className="env-install-command-row">
											<label className="env-install-command-label">
												{t("environment.installCommandLabel")}
											</label>
											<input
												type="text"
												className="env-install-command-input"
												value={props.installCommand}
												onChange={(e) =>
													props.onInstallCommandChange(e.target.value)
												}
												disabled={props.installExecuting}
												placeholder="npm install -g @earendil-works/pi-coding-agent"
											/>
										</div>
										<div className="env-install-actions">
											<button
												className={`env-card-btn env-mirror-btn ${props.installUseMirror ? "active" : ""}`}
												onClick={props.onToggleInstallMirror}
												disabled={props.installExecuting}
												title={t("environment.installUseMirror")}
											>
												{props.installUseMirror
													? t("environment.installRemoveMirror")
													: t("environment.installUseMirror")}
											</button>
											<button
												className="env-card-btn primary"
												onClick={props.onExecInstall}
												disabled={props.installExecuting || !props.installCommand.trim()}
											>
												{props.installExecuting
													? t("environment.installExecuting")
													: t("environment.installExec")}
											</button>
										</div>

										{/* 安装进行中：显示进度 */}
										{props.installExecuting && (
											<div className="env-install-progress">
												<div className="loader" />
												<span>{t("environment.installExecuting")}</span>
											</div>
										)}

										{/* 安装完成 */}
										{props.installCompleted && (
											<div className="env-install-success">
												<div className="env-success-icon">✓</div>
												<div className="env-success-info">
													<strong>{t("environment.installSuccess")}</strong>
													<small>{t("environment.installRestartHint")}</small>
												</div>
												<button
													className="env-card-btn primary"
													onClick={props.onRestartApp}
												>
													{t("environment.restartApp")}
												</button>
											</div>
										)}

										{/* 安装结果输出 */}
										{props.installResult && (
											<div className={`env-install-result ${props.installResult.success ? "success" : "error"}`}>
												<strong>
													{props.installResult.success
														? t("environment.installCompleted")
														: t("environment.installFailed")}
													{t("environment.installExitCode")}：{props.installResult.exitCode}
												</strong>
												{props.installResult.stdout && (
													<>
														<span>{t("environment.installOutput")}</span>
														<pre className="env-install-output-pre">{props.installResult.stdout}</pre>
													</>
												)}
												{props.installResult.stderr && (
													<pre className="env-install-output-pre env-install-stderr">{props.installResult.stderr}</pre>
												)}
											</div>
										)}
									</div>
								)}

								{/* npm 不可用：引导安装 Node.js */}
								{props.npmAvailable === false && !props.npmChecking && (
									<div className="env-install-npm-missing">
										<strong>{t("environment.npmNotFoundTitle")}</strong>
										<small>{t("environment.npmNotFoundDesc")}</small>
										<button
											className="env-card-btn"
											onClick={() =>
												window.piDesktop.app.openExternal(
													"https://nodejs.org/zh-cn/download/"
												)
											}
										>
											{t("environment.openNodejsOrg")}
										</button>
									</div>
								)}
							</div>

							{/* 手动输入 pi 路径卡片 */}
							<div className="env-card env-custom-card">
								<strong>{t("environment.customPathTitle")}</strong>
								<small>{t("environment.customPathDesc")}</small>
								<div className="ref-commands">
									<div className="ref-command-item">
										<span className="ref-label">{t("environment.commandLabel")}</span>
										<code>{refCmd}</code>
									</div>

								</div>
								<div className="custom-path-input-row">
									<input
										type="text"
										placeholder="D:\\mise-data\\installs\\node\\24 13 0\\pi.cmd"
										value={props.customPath}
										onChange={(e) =>
											props.onCustomPathChange(e.target.value)
										}
										disabled={props.customPathValidating}
									/>
									<button
										className="env-card-btn primary"
										onClick={props.onValidateCustomPath}
										disabled={
											!props.customPath.trim() ||
											props.customPathValidating
										}
									>
										{props.customPathValidating
											? t("environment.validatingPath")
											: t("environment.validatePath")}
									</button>
								</div>
								{props.customPathResult && (
									<div
										className={`custom-path-result ${props.customPathResult.installed ? "success" : "error"}`}
									>
										{props.customPathResult.installed
											? `✓ ${t("environment.validatePassed", { value: props.customPathResult.version ?? "pi" })}`
											: `✗ ${t("environment.validateFailed", { value: props.customPathResult.error ?? t("environment.unableToRun") })}`}
									</div>
								)}
							</div>

							{/* 检测路径卡片 */}
							{searchedDirs.length > 0 && (
								<div className="env-card env-dirs-card">
									<strong>{t("environment.searchedDirs")}</strong>
									<small>{t("environment.searchedDirsDesc")}</small>
									<ul className="env-dirs-list">
										{searchedDirs.map((dir) => (
											<li key={dir}>{dir}</li>
										))}
									</ul>
								</div>
							)}
						</>
					)}
				</div>

				<div className="environment-footer">
					<button
						onClick={props.onRecheck}
						disabled={props.checking || props.customPathValidating}
					>
						{t("environment.recheck")}
					</button>
					{props.onClearCheckFlag && (
						<button
							className="env-clear-flag-btn"
							onClick={props.onClearCheckFlag}
							title={t("environment.clearCheckFlagHint")}
						>
							{t("environment.clearCheckFlag")}
						</button>
					)}
				</div>
			</Modal>
	);
}


export function ConfirmDialog(props: {
	title: string;
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
	confirmLabel?: string;
	danger?: boolean;
}) {
	// 实现已收敛到 ui-shadcn/ConfirmDialog（AlertDialog），此处仅保留兼容转发，
	// 避免一次性改动所有 import 路径；后续批量替换 import 后删除本包装。
	return <ShadcnConfirmDialog {...props} />;
}

// ============================================================
// Re-exports from Surface domain (session rendering components)
// 保持旧 import 路径继续工作
// ============================================================
export {
  SessionStatus,
  LogoMark,
  AgentAvatar,
  EmptyState,
  ToolCard,
  ToolGroupCard,
  CompactionCard,
  DiagnosticMessageCard,
  AskQuestionCard,
  ThinkingBlock,
  RespondingIndicator,
  AssistantText,
  TurnRow,
  UserBubble,
  ImagePreviewModal,
  stripMarkdown,
  MultiSelectModal,
  ConversationOutline,
  DrawerContent,
  SessionFileSummary,
  SessionHistoryModal,
  PromptSuggestions,
  FileContextMenu,
} from "../session/SurfaceComponents";

// PiLogoCanvas — canvas-based animated pi logo (from upstream dev)
export { PiLogoCanvas } from "./PiLogoCanvas";

/** Brand lockup: PiLogoCanvas + wordmark（pure official 中性字重/间距） */
export function BrandLockup(props: { replayToken?: number } = {}) {
	return (
		<div className="brand-lockup flex h-9 min-w-0 items-center gap-2.5" aria-label="PiDeck">
			<PiLogoCanvas size={28} autoPlay playOnClick replayToken={props.replayToken} />
			<span className="brand-wordmark truncate text-[15px] font-semibold tracking-tight text-foreground" aria-hidden="true">PiDeck</span>
		</div>
	);
}


