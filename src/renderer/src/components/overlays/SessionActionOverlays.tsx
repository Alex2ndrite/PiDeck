import { lazy, Suspense, useEffect, useMemo, useState, type ComponentProps } from "react";
const SettingsModal = lazy(() => import("../app/SettingsModal").then((module) => ({ default: module.SettingsModal })));
import { ConfirmDialog } from "./OverlayParts";
import { TrustConfirmModal } from "../app/TrustConfirmModal";
import { CloseIconButton } from "../ui/IconButton";
import { t } from "../../i18n";
import type { AppInfo, FeedbackEnvironment, Project } from "../../../../shared/types";

export type FeedbackOverlayProps = {
	open: boolean;
	project?: Project;
	appInfo: AppInfo;
	loadEnvironment: () => Promise<FeedbackEnvironment>;
	onClose: () => void;
	onCopy?: () => void;
	onOpenExternal: (url: string) => Promise<void> | void;
};

function maskHomePath(value: string) {
	return value.replace(/^([A-Za-z]:)?[\\/]Users[\\/][^\\/]+/i, "$1~");
}

function buildFeedbackReport(input: { description: string; steps: string; project?: Project; environment: FeedbackEnvironment | null; fallbackVersion: string; environmentError: string }) {
	const pi = input.environment?.pi;
	const projectPath = input.project?.path ? maskHomePath(input.project.path) : t("feedback.report.projectNone");
	return [
		t("feedback.report.description"), input.description.trim() || t("feedback.report.descriptionEmpty"), "",
		t("feedback.report.steps"), input.steps.trim() || t("feedback.report.stepsEmpty"), "",
		t("feedback.report.environment"),
		t("feedback.report.piDesktop", { value: input.environment?.appVersion ?? input.fallbackVersion }),
		t("feedback.report.system", { value: input.environment ? `${input.environment.platform} ${input.environment.arch}` : t("feedback.report.readFailed") }),
		t("feedback.report.electron", { value: input.environment?.electronVersion ?? "-" }),
		t("feedback.report.chrome", { value: input.environment?.chromeVersion ?? "-" }),
		t("feedback.report.node", { value: input.environment?.nodeVersion ?? "-" }),
		t("feedback.report.project", { value: projectPath }),
		t("feedback.report.piStatus", { value: pi ? (pi.installed ? t("feedback.report.piDetected") : t("feedback.report.piMissing")) : t("feedback.report.readFailed") }),
		t("feedback.report.piCommand", { value: pi?.command ? maskHomePath(pi.command) : "-" }),
		t("feedback.report.piVersion", { value: pi?.version || "-" }),
		...(pi?.error ? [t("feedback.report.piError", { value: pi.error })] : []),
		...(input.environmentError ? [t("feedback.report.environmentError", { value: input.environmentError })] : []),
	].join("\n");
}

export function FeedbackOverlay({ open, project, appInfo, loadEnvironment, onClose, onCopy, onOpenExternal }: FeedbackOverlayProps) {
	const [description, setDescription] = useState("");
	const [steps, setSteps] = useState("");
	const [environment, setEnvironment] = useState<FeedbackEnvironment | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!open) {
			setDescription("");
			setSteps("");
			setEnvironment(null);
			setError("");
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError("");
		loadEnvironment().then((next) => { if (!cancelled) setEnvironment(next); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [loadEnvironment, open]);
	const report = useMemo(() => buildFeedbackReport({ description, steps, project, environment, fallbackVersion: appInfo.version, environmentError: error }), [appInfo.version, description, environment, error, project, steps]);
	if (!open) return null;
	const summary = description.trim().split("\n")[0].slice(0, 60);
	const issueTitle = `${t("feedback.issueTitle")}${summary || t("feedback.issueTitleEmpty")}`;
	const issueUrl = `https://github.com/ayuayue/pi-desktop/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(report)}`;
	const copyReport = async () => { await navigator.clipboard.writeText(report); onCopy?.(); };
	return (
		<div className="modal-backdrop feedback-backdrop" onClick={onClose}>
			<section className="feedback-modal" onClick={(event) => event.stopPropagation()}>
				<div className="modal-header feedback-header"><div><strong>{t("feedback.title")}</strong><small>{t("feedback.intro")}</small></div><CloseIconButton label={t("common.close")} onClick={onClose} /></div>
				<div className="feedback-body">
					<div className="feedback-form-section"><div className="feedback-section-header"><strong>{t("feedback.descriptionLabel")}</strong><small>{t("feedback.descriptionHint")}</small></div><textarea className="feedback-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("feedback.descriptionPlaceholder")} /><div className="feedback-section-header"><strong>{t("feedback.stepsLabel")}</strong><small>{t("feedback.stepsHint")}</small></div><textarea className="feedback-textarea" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={t("feedback.stepsPlaceholder")} /></div>
					<div className="feedback-environment-section"><div className="feedback-section-header"><strong>{t("feedback.environmentTitle")}</strong><small>{loading ? t("feedback.reportLoading") : t("feedback.environmentHint")}</small></div><pre className="feedback-environment-content">{report}</pre></div>
				</div>
				<div className="feedback-actions"><button onClick={() => void copyReport()}>{t("feedback.copyReport")}</button><button onClick={() => void onOpenExternal("https://github.com/ayuayue")}>{t("feedback.authorGithub")}</button><button className="primary" onClick={() => void onOpenExternal(issueUrl)}>{t("feedback.openIssue")}</button></div>
			</section>
		</div>
	);
}

export type TrustOverlayProps = {
	open: boolean;
	requestId: string;
	cwd: string;
	projectName: string;
	onChoose: (choice: "trust-remember" | "trust-session" | "deny") => void | Promise<void>;
};

export type SessionActionOverlaysProps = {
	settings?: { open: boolean; props: ComponentProps<typeof SettingsModal> };
	feedback?: FeedbackOverlayProps;
	confirm?: { open: boolean; props: ComponentProps<typeof ConfirmDialog> };
	trust?: TrustOverlayProps;
};

export function SessionActionOverlays({ settings, feedback, confirm, trust }: SessionActionOverlaysProps) {
	return <>
		{settings?.open && <Suspense fallback={null}><SettingsModal {...settings.props} /></Suspense>}
		{feedback && <FeedbackOverlay {...feedback} />}
		{confirm?.open && <ConfirmDialog {...confirm.props} />}
		{trust?.open && <TrustConfirmModal cwd={trust.cwd} projectName={trust.projectName} onChoose={trust.onChoose} />}
	</>;
}
