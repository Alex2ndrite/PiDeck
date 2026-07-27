import { useState } from "react";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import type { PiCliUpdateResult, PiExtensionListResult, PiExtensionSummary, PiPackageInfo } from "../../../shared/types";
import { t, type TranslationKey } from "../i18n";

type ExtensionsApi = {
	list: () => Promise<PiExtensionListResult>;
	uninstall: (source: string, scope?: "user" | "project" | "unknown") => Promise<void>;
	install: (source: string) => Promise<string>;
	toggle: (source: string, enabled: boolean) => Promise<void>;
	update: () => Promise<PiCliUpdateResult>;
};

function getExtensionsApi(): ExtensionsApi {
	const api = (window as unknown as { piDesktop?: { extensions?: ExtensionsApi } })
		.piDesktop?.extensions;
	if (!api) throw new Error("PiDeck extensions API is not available");
	return api;
}

type RecommendedPackage = Omit<PiPackageInfo, "description"> & {
	descriptionKey: TranslationKey;
};

/** 预设推荐扩展包 */
const RECOMMENDED_PACKAGES: RecommendedPackage[] = [
	{
		name: "context-mode",
		descriptionKey: "config.recommendedPackage.contextMode",
		installCmd: "npm:context-mode",
		tags: ["extension"],
		downloads: "107K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/context-mode",
		repoUrl: "https://github.com/mksglu/context-mode",
	},
	{
		name: "pi-web-access",
		descriptionKey: "config.recommendedPackage.webAccess",
		installCmd: "npm:pi-web-access",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-web-access",
		repoUrl: "https://github.com/nicobailon/pi-web-access",
	},
	{
		name: "pi-mcp-adapter",
		descriptionKey: "config.recommendedPackage.mcpAdapter",
		installCmd: "npm:pi-mcp-adapter",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-mcp-adapter",
		repoUrl: "https://github.com/nicobailon/pi-mcp-adapter",
	},
	{
		name: "@samfp/pi-memory",
		descriptionKey: "config.recommendedPackage.memory",
		installCmd: "npm:@samfp/pi-memory",
		tags: ["extension", "memory"],
		downloads: "",
		updated: "",
		npmUrl: "https://pi.dev/packages/@samfp/pi-memory?name=%40samfp%2Fpi-memory",
	},
	{
		name: "pi-subagents",
		descriptionKey: "config.recommendedPackage.subagents",
		installCmd: "npm:pi-subagents",
		tags: ["extension"],
		downloads: "92K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-subagents",
		repoUrl: "https://github.com/nicobailon/pi-subagents",
	},
];

export function ExtensionsTab(props: {
	data: PiExtensionListResult;
	loading: boolean;
	uninstallingSource: string | null;
	onRefresh: () => void;
	onUninstall: (extension: PiExtensionSummary) => void;
}) {
	const [installingSources, setInstallingSources] = useState<Set<string>>(() => new Set());
	const [togglingSource, setTogglingSource] = useState<string | null>(null);

	const handleToggle = async (extension: PiExtensionSummary) => {
		if (togglingSource) return;
		setTogglingSource(extension.source);
		try {
			const nextEnabled = extension.enabled !== false ? false : true;
			await getExtensionsApi().toggle(extension.source, nextEnabled);
			// 与安装/卸载一致：强制刷新列表，确保 enabled 与缓存同步。
			props.onRefresh();
		} catch (e) {
			console.error("[Extensions] Toggle failed", e);
			alert(t("config.extensionToggleFailed"));
		} finally {
			setTogglingSource(null);
		}
	};
	const [updating, setUpdating] = useState<string | null>(null);
	const [updateResult, setUpdateResult] = useState<PiCliUpdateResult | null>(null);
	const [showUpdateDialog, setShowUpdateDialog] = useState(false);

	const handleInstall = async (pkg: RecommendedPackage) => {
		// 安装任务按扩展源分别记录；多个扩展并发安装时，不能用单一字符串覆盖前一个 loading 状态。
		setInstallingSources((current) => new Set(current).add(pkg.installCmd));
		try {
			await getExtensionsApi().install(pkg.installCmd);
			props.onRefresh();
		} catch (e) {
			console.error("[Extensions] Install failed", e);
			alert(t("config.installFailed"));
		} finally {
			setInstallingSources((current) => {
				const next = new Set(current);
				next.delete(pkg.installCmd);
				return next;
			});
		}
	};

	const handleUpdateExtensions = async () => {
		setUpdating("all");
		setUpdateResult(null);
		setShowUpdateDialog(true);
		try {
			const result = await getExtensionsApi().update();
			setUpdateResult(result);
		} catch (e) {
			console.error("[Extensions] Update failed", e);
			alert(t("settings.extensionsUpdateFailedGeneric"));
		} finally {
			setUpdating(null);
		}
	};

	return (
		<div className="extensions-tab">
			{showUpdateDialog && (
				<div className="config-update-dialog-backdrop" role="dialog" aria-modal="true">
					<div className="config-update-dialog">
						<div className="config-update-dialog-header">
							<strong>{t("settings.updateExtensionsAll")}</strong>
							<button
								className="config-icon-btn"
								onClick={() => {
									setShowUpdateDialog(false);
									props.onRefresh();
								}}
								disabled={Boolean(updating)}
							>
								×
							</button>
						</div>
						<p className="config-im-form-hint">
							{updating ? t("settings.extensionsUpdatingDesc") : t("settings.extensionsUpdateResultHint")}
						</p>
						<pre className="setting-update-output">
							{updateResult ? `${updateResult.command}\n${updateResult.output}` : t("settings.extensionsUpdating")}
						</pre>
						<div className="config-update-dialog-actions">
							<button
								className="config-btn primary"
								onClick={() => {
									setShowUpdateDialog(false);
									props.onRefresh();
								}}
								disabled={Boolean(updating)}
							>
								{t("common.close")}
							</button>
						</div>
					</div>
				</div>
			)}
			{/* 预设推荐扩展 — 大列表简洁显示 */}
			<div className="config-section" style={{ marginBottom: 20 }}>
				<div className="config-toolbar">
					<h3 className="extensions-installed-title">{t("config.recommendedPackages")}</h3>
				</div>
				<p className="config-im-form-hint" style={{ marginBottom: 12 }}>
					{t("config.recommendedPackagesHint")}
				</p>
				<div className="extensions-recommended-list">
					{RECOMMENDED_PACKAGES.map((pkg) => {
						const alreadyInstalled = props.data.extensions.some((ext) => ext.source === pkg.installCmd);
						const installing = installingSources.has(pkg.installCmd);
						return (
						<div
							key={pkg.name}
							className="extensions-recommended-row"
							onClick={() => {
								// pi.dev 的详情路由使用 npm 包名,但查询参数可能是扩展内部展示名。
								const packageName = pkg.piPackageName ?? pkg.name;
								window.open(`https://pi.dev/packages/${pkg.name}?name=${packageName}`, '_blank');
							}}
							title={`${t("config.openPackageDetail")}: ${pkg.name}`}
						>
							<div className="extensions-recommended-info">
								<div className="extensions-recommended-name">
									<strong>{pkg.name}</strong>
									{alreadyInstalled && <span className="config-im-connected-badge" style={{ marginLeft: 8 }}>{t("config.installed")}</span>}
								</div>
							<div className="extensions-recommended-desc">
								{t(pkg.descriptionKey)}
								</div>
							</div>
							<div className="extensions-recommended-action" onClick={(e) => e.stopPropagation()}>
								{installing ? (
									<span className="config-btn" style={{ opacity: 0.6 }}>{t("config.installing")}</span>
								) : (
									<button
										className="config-btn"
										onClick={() => handleInstall(pkg)}
										disabled={alreadyInstalled || installing}
									>
										{alreadyInstalled ? t("config.installed") : t("config.install")}
									</button>
								)}
							</div>
						</div>
					);
					})}
				</div>
			</div>

			<hr className="extensions-divider" />

			{/* 已安装扩展列表 */}
			<div className="config-section">
				<h3 className="extensions-installed-title">{t("config.installedExtensions")}</h3>
				<div className="config-toolbar" style={{ marginTop: 8 }}>
					<div>
						<span className="config-count">
							{t("config.count.extensions", { count: props.data.extensions.length })}
						</span>
						<small className="skills-restart-hint">
							{t("config.extensionRestartHint")}
						</small>
					</div>
					<div className="skills-toolbar-actions">
						<button className="config-btn" onClick={handleUpdateExtensions} disabled={props.loading || Boolean(updating)}>
							{updating ? t("settings.updating") : t("settings.updateExtensionsAll")}
						</button>
						<button className="config-btn" onClick={props.onRefresh} disabled={props.loading}>
							{t("common.refresh")}
						</button>
					</div>
				</div>
				<div className="skills-list">
					{props.loading ? (
						<div className="config-loading">{t("config.loadingExtensions")}</div>
					) : props.data.extensions.length === 0 ? (
						<div className="config-empty">{t("config.emptyExtensions")}</div>
					) : (
						props.data.extensions.map((extension) => (
							<ExtensionCard
								key={extension.id}
								extension={extension}
								uninstalling={props.uninstallingSource === extension.source}
								onUninstall={props.onUninstall}
								onToggle={handleToggle}
								toggling={togglingSource === extension.source}
							/>
						))
					)}
				</div>
			</div>
		</div>
	);
}

function ExtensionCard(props: {
	extension: PiExtensionSummary;
	uninstalling: boolean;
	toggling?: boolean;
	onUninstall: (extension: PiExtensionSummary) => void;
	onToggle: (extension: PiExtensionSummary) => void;
}) {
	const { extension } = props;
	const name = extension.source.replace(/^(?:npm|file|github|git):/i, "");
	return (
		<article className="session-card skill-card extension-card">
			<div className="session-card-display">
				<div className="session-card-inner skill-card-main">
					<div className="session-card-title skill-title-row">
						<strong>{name}</strong>
						<div className="skill-badges">
							{extension.builtIn && (
								<span className="skill-state enabled">{t("common.builtIn")}</span>
							)}
							<span className={`skill-state ${extension.enabled === false ? "disabled" : "enabled"}`}>
								{extension.enabled !== false ? t("common.enabled") : t("common.disabled")}
							</span>
							<span className="skill-state enabled">
								{extension.scope === "project"
									? t("common.project")
									: t("common.global")}
							</span>
						</div>
					</div>
					<small>{extension.source}</small>
					{!extension.builtIn && (
						<small>
							{t("config.extensionVersions", {
								current: extension.currentVersion ?? "-",
								latest: extension.latestVersion ?? "-",
							})}
							{extension.hasUpdate ? ` · ${t("config.extensionUpdateAvailable")}` : ""}
						</small>
					)}
					{extension.updateError && <small className="setting-status error">{extension.updateError}</small>}
					{extension.path && <small>{extension.path}</small>}
				</div>
				<div className="prompts-list-item-actions">
					<button
						className="config-icon-btn"
						disabled={props.toggling}
						onClick={() => props.onToggle(extension)}
						title={extension.enabled !== false ? t("common.disable") : t("common.enabled")}
						style={extension.enabled !== false ? { color: "var(--color-accent)" } : undefined}
					>
						{extension.enabled !== false ? <ToggleRight size={14} strokeWidth={1.8} /> : <ToggleLeft size={14} strokeWidth={1.8} />}
					</button>
					{!extension.builtIn && (
						<button
							className="config-icon-btn danger"
							disabled={props.uninstalling}
							onClick={() => props.onUninstall(extension)}
							title={props.uninstalling ? t("config.uninstalling") : t("config.uninstall")}
						>
							<Trash2 size={14} strokeWidth={1.8} />
						</button>
					)}
				</div>
			</div>
		</article>
	);
}
