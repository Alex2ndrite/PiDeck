import { ConfirmDialog } from "../../ui-shadcn/ConfirmDialog";
import { useEffect, useState, type ReactNode } from "react";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { SectionHeading } from "../../ui-shadcn/section-heading";
import type { AppSettings } from "../../../../../shared/types";

export function SettingsSection(props: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="settings-section">
			<SectionHeading
				className="settings-section-header"
				title={props.title}
				description={props.description}
			/>
			<div className="settings-section-body">{props.children}</div>
		</section>
	);
}
/** 存储管理子标签页 */
export function StorageTab(props: {
	settings: AppSettings;
	onChange: (patch: Partial<AppSettings>) => void;
}) {
	const [logsSize, setLogsSize] = useState<string>("");
	const [rpcLogsSize, setRpcLogsSize] = useState<string>("");
	const [clearing, setClearing] = useState<string | null>(null);
	const [feedback, setFeedback] = useState("");
	const [confirmDialog, setConfirmDialog] = useState<{
		title: string;
		message: string;
		onConfirm: () => void;
	} | null>(null);

	useEffect(() => {
		let mounted = true;
		const refresh = () => {
			void window.piDesktop.logs.getSize().then((bytes) => {
				if (mounted) setLogsSize(formatBytes(bytes));
			});
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		return () => { mounted = false; clearInterval(timer); };
	}, []);

	useEffect(() => {
		let mounted = true;
		const refresh = () => {
			void window.piDesktop.rpcLogs.getSize().then((bytes) => {
				if (mounted) setRpcLogsSize(formatBytes(bytes));
			});
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		return () => { mounted = false; clearInterval(timer); };
	}, []);

	const doClear = async (target: string) => {
		setClearing(target);
		setFeedback("");
		try {
			if (target === "app") {
				await window.piDesktop.logs.clear();
			} else if (target === "rpc") {
				await window.piDesktop.rpcLogs.clear();
			} else {
				await window.piDesktop.logs.clear();
				await window.piDesktop.rpcLogs.clear();
			}
			setFeedback(t("settings.storage.clearSuccess"));
		} catch (e) {
			setFeedback(`${t("common.error")}: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setClearing(null);
		}
	};

	const confirmClear = (target: string, label: string) => {
		setConfirmDialog({
			title: t("app.confirm"),
			message: t("settings.storage.clearConfirm", { label }),
			onConfirm: () => { doClear(target); setConfirmDialog(null); },
		});
	};

	const handleOpenFolder = async () => {
		try {
			await window.piDesktop.logs.openFolder();
		} catch (e) {
			setFeedback(`${t("common.error")}: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	return (
		<>
			{confirmDialog && (
				// #115：手写确认浮层删除，统一走 shadcn ConfirmDialog（AlertDialog）
				<ConfirmDialog
					title={confirmDialog.title}
					message={confirmDialog.message}
					danger
					onConfirm={confirmDialog.onConfirm}
					onCancel={() => setConfirmDialog(null)}
				/>
			)}
			<SettingsSection title={t("settings.storage.appLogs")}>
				<div className="setting-row">
					<div>
						<strong>{t("settings.storage.appLogsSize")}</strong>
						<small>{logsSize || t("common.loading")}</small>
					</div>
					<Button variant="secondary"
						loading={clearing === "app" || clearing === "all"}
						disabled={clearing !== null}
						onClick={() => confirmClear("app", t("settings.storage.appLogs"))}
					>
						{t("common.delete")}
					</Button>
				</div>
			</SettingsSection>
			<SettingsSection title={t("settings.storage.rpcLogs")}>
				<div className="setting-row">
					<div>
						<strong>{t("settings.storage.rpcLogsSize")}</strong>
						<small>{rpcLogsSize || t("common.loading")}</small>
					</div>
					<Button variant="secondary"
						loading={clearing === "rpc" || clearing === "all"}
						disabled={clearing !== null}
						onClick={() => confirmClear("rpc", t("settings.storage.rpcLogs"))}
					>
						{t("common.delete")}
					</Button>
				</div>
				{feedback && (
					<small className={`setting-status ${feedback.includes(t("common.error")) ? "error" : "success"}`}>
						{feedback}
					</small>
				)}
			</SettingsSection>
			<SettingsSection title={t("settings.storage.actions")}>
				<div className="setting-row">
					<div>
						<strong>{t("settings.storage.clearAll")}</strong>
						<small>{t("settings.storage.clearAllDesc")}</small>
					</div>
					<Button
						variant="destructive"
						loading={clearing === "all"}
						disabled={clearing !== null}
						onClick={() => confirmClear("all", `${t("settings.storage.appLogs")} + ${t("settings.storage.rpcLogs")}`)}
					>
						{t("settings.storage.clearAllButton")}
					</Button>
				</div>
				<div className="setting-row">
					<div>
						<strong>{t("settings.storage.openFolder")}</strong>
						<small>{t("settings.storage.openFolderDesc")}</small>
					</div>
					<Button variant="secondary" onClick={handleOpenFolder}>
						{t("common.open")}
					</Button>
				</div>
			</SettingsSection>
		</>
	);
}

function formatBytes(value: number) {
	if (value === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
	return `${(value / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}
