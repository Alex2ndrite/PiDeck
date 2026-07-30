import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../../i18n";
import { CloseIconButton } from "../ui/IconButton";
import type { AppUpdateInfo, AppUpdateDownloadProgress } from "../../../../shared/types";
import type { AppUpdateControllerState } from "../../hooks/useAppUpdateController";

export type AppUpdateOverlayProps = {
	controller: Pick<AppUpdateControllerState, "info" | "error" | "checking" | "downloading" | "progress" | "downloadedPath" | "download" | "install" | "clear">;
	releasesUrl: string;
	openExternal: (url: string, forceSystem?: boolean) => Promise<void> | void;
	upToDateVersion?: string | null;
	onDismissUpToDate?: () => void;
};

function formatBytes(bytes?: number) {
	if (!bytes || bytes < 1024) return `${bytes ?? 0} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes;
	let index = -1;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}

function UpdateDialog(props: {
	info: AppUpdateInfo;
	progress: AppUpdateDownloadProgress | null;
	checking: boolean;
	downloading: boolean;
	downloadedPath: string | null;
	onClose: () => void;
	onDownload: () => void;
	onInstall: () => void;
	onBrowserDownload: () => void;
	error?: string | null;
	onOpenRelease: () => void;
}) {
	const percent = props.progress?.percent ?? 0;
	return (
		<div className="modal-backdrop update-backdrop" onClick={props.onClose}>
			<section className="update-modal" onClick={(event) => event.stopPropagation()}>
				<div className="modal-header">
					<strong>{t("update.availableTitle", { version: props.info.latestVersion })}</strong>
					<CloseIconButton label={t("common.close")} onClick={props.onClose} />
				</div>
				<div className="update-body">
					<p className="update-version-line">{t("update.currentLatest", { current: props.info.currentVersion, latest: props.info.latestVersion })}</p>
					{props.info.recommendedAsset && <p className="update-asset-line">{t("update.recommendedAsset", { name: props.info.recommendedAsset.name })}</p>}
					{props.progress && (
						<div className="update-download-progress">
							<div className="update-progress-header"><span>{props.progress.assetName}</span><span>{percent ? `${percent.toFixed(1)}%` : t("update.downloading")}</span></div>
							<div className="update-progress-track"><div className="update-progress-bar" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>
							<div className="update-progress-meta"><span>{formatBytes(props.progress.receivedBytes)} / {formatBytes(props.progress.totalBytes)}</span><span>{props.progress.bytesPerSecond ? `${formatBytes(props.progress.bytesPerSecond)}/s` : ""}</span></div>
							{props.downloadedPath && <div className="update-downloaded-path">{props.downloadedPath}</div>}
						</div>
					)}
					{props.error && <div className="update-error-detail" role="alert">{t("update.errorInfo", { message: props.error })}</div>}
					<div className="update-notes markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{props.info.releaseNotes.trim() || t("update.noReleaseNotes")}</ReactMarkdown></div>
				</div>
				<div className="update-actions">
					<button onClick={props.onOpenRelease}>{t("update.openRelease")}</button>
					<button onClick={props.onBrowserDownload}>{t("update.browserDownload")}</button>
					{props.downloadedPath ? <button className="primary" onClick={props.onInstall}>{t("update.installDownloaded")}</button> : <button className="primary" disabled={props.checking || props.downloading || !props.info.recommendedAsset} onClick={props.onDownload}>{props.downloading ? t("update.downloading") : t("update.downloadInApp")}</button>}
				</div>
			</section>
		</div>
	);
}

export function AppUpdateOverlay({ controller, releasesUrl, openExternal, upToDateVersion, onDismissUpToDate }: AppUpdateOverlayProps) {
	const info = controller.info;
	if (info) {
		return <UpdateDialog info={info} progress={controller.progress} checking={controller.checking} downloading={controller.downloading} downloadedPath={controller.downloadedPath} onClose={controller.clear} onDownload={() => void controller.download()} onInstall={() => void controller.install()} error={controller.error} onBrowserDownload={() => void openExternal(info.recommendedAsset?.url ?? info.releaseUrl, true)} onOpenRelease={() => void openExternal(info.releaseUrl, true)} />;
	}
	if (controller.error) {
		return (
			<div className="modal-backdrop update-backdrop" onClick={controller.clear}>
				<section className="update-modal update-error-modal" onClick={(event) => event.stopPropagation()}>
					<div className="modal-header"><strong>{t("update.checkFailedTitle")}</strong><CloseIconButton label={t("common.close")} onClick={controller.clear} /></div>
					<div className="update-body"><p className="update-version-line">{t("update.checkFailedDescription")}</p><div className="update-error-detail">{t("update.errorInfo", { message: controller.error })}</div><p className="update-asset-line">{t("update.manualReleaseHint")}<br /><span>{releasesUrl}</span></p></div>
					<div className="update-actions"><button onClick={controller.clear}>{t("common.close")}</button><button className="primary" onClick={() => void openExternal(releasesUrl, true)}>{t("update.openReleasePage")}</button></div>
				</section>
			</div>
		);
	}
	if (upToDateVersion) {
		return (
			<div className="modal-backdrop update-backdrop" onClick={onDismissUpToDate}>
			<section className="update-modal update-uptodate-modal" onClick={(event) => event.stopPropagation()}>
				<div className="modal-header"><strong>{t("update.upToDateTitle")}</strong><CloseIconButton label={t("common.close")} onClick={onDismissUpToDate ?? (() => undefined)} /></div>
				<div className="update-body"><p className="update-version-line">{t("update.upToDateMessage", { version: upToDateVersion })}</p></div>
				<div className="update-actions"><button onClick={onDismissUpToDate}>{t("common.close")}</button><button onClick={() => void openExternal(releasesUrl, true)}>{t("update.openReleasePage")}</button></div>
			</section>
			</div>
		);
	}
	return null;
}
