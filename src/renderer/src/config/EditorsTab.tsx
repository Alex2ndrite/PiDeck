import { Button } from "../components/ui-shadcn/button";
import { useEffect, useState } from "react";
import type { PiDesktopApi } from "../../../preload";
import {
	SUPPORTED_EXTERNAL_EDITORS,
	type AppSettings,
	type ExternalEditorId,
} from "../../../shared/types";
import { t } from "../i18n";
import { Checkbox } from "../components/ui-shadcn/checkbox";
import { Input } from "../components/ui-shadcn/input";

const api: PiDesktopApi = (window as unknown as { piDesktop: PiDesktopApi }).piDesktop;

export function EditorsTab() {
	const [settings, setSettings] = useState<AppSettings | null>(null);
	const [drafts, setDrafts] = useState<Record<ExternalEditorId, string>>(
		{} as Record<ExternalEditorId, string>,
	);
	const [savingId, setSavingId] = useState<ExternalEditorId | null>(null);
	const [detecting, setDetecting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		const next = await api.settings.get();
		setSettings(next);
		setDrafts(
			Object.fromEntries(
				SUPPORTED_EXTERNAL_EDITORS.map((editor) => [
					editor.id,
					next.externalEditors[editor.id]?.command ?? "",
				]),
			) as Record<ExternalEditorId, string>,
		);
	};

	useEffect(() => {
		void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, []);

	const updateEditor = async (
		editorId: ExternalEditorId,
		patch: Parameters<PiDesktopApi["editors"]["update"]>[1],
	) => {
		setSavingId(editorId);
		setError(null);
		try {
			const next = await api.editors.update(editorId, patch);
			setSettings(next);
			setDrafts((current) => ({
				...current,
				[editorId]: next.externalEditors[editorId]?.command ?? "",
			}));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSavingId(null);
		}
	};

	const redetect = async () => {
		setDetecting(true);
		setError(null);
		try {
			const next = await api.editors.redetect();
			setSettings(next);
			setDrafts(
				Object.fromEntries(
					SUPPORTED_EXTERNAL_EDITORS.map((editor) => [
						editor.id,
						next.externalEditors[editor.id]?.command ?? "",
					]),
				) as Record<ExternalEditorId, string>,
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setDetecting(false);
		}
	};

	const chooseExecutable = async (editorId: ExternalEditorId) => {
		const selected = await api.editors.chooseExecutable();
		if (!selected) return;
		setDrafts((current) => ({
			...current,
			[editorId]: selected,
		}));
	};

	if (!settings) return <div className="py-12 text-center text-[13px] text-text-tertiary">{t("common.loading")}</div>;

	return (
		<div className="editors-tab">
			<div className="mb-3.5 flex items-center justify-between">
				<div>
					<strong>{t("editors.title")}</strong>
					<p className="config-im-form-hint">{t("editors.hint")}</p>
				</div>
				<Button  variant="outline" onClick={redetect} disabled={detecting}>
					{detecting ? t("editors.detecting") : t("editors.redetect")}
				</Button>
			</div>
			{error && <div className="mb-3.5 rounded-sm border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-danger whitespace-pre-line">{error}</div>}
			<div className="editors-list">
				{SUPPORTED_EXTERNAL_EDITORS.map((editor) => {
					const configured = settings.externalEditors[editor.id];
					const draft = drafts[editor.id] ?? "";
					const saving = savingId === editor.id;
					return (
						<section key={editor.id} className="editor-config-row">
							<div className="editor-config-meta">
								<strong>{editor.name}</strong>
								<small>
									{configured.command
										? t("editors.detectedFrom", {
												source: configured.detectedFrom ?? "manual",
											})
										: t("editors.notConfigured")}
								</small>
							</div>
							<label className="editor-config-enabled">
								<Checkbox
									checked={configured.enabled}
									onCheckedChange={(checked) =>
										void updateEditor(editor.id, { enabled: checked === true })
									}
								/>
								<span>{t("editors.enabled")}</span>
							</label>
							<div className="editor-config-path-control">
								<Input
									className="editor-config-path"
									value={draft}
									onChange={(event) =>
										setDrafts((current) => ({
											...current,
											[editor.id]: event.target.value,
										}))
									}
									placeholder={t("editors.pathPlaceholder")}
								/>
								<Button  variant="outline" onClick={() => void chooseExecutable(editor.id)}>
									{t("editors.browse")}
								</Button>
							</div>
							<div className="editor-config-actions">
								<Button
									 variant="default"
									onClick={() => void updateEditor(editor.id, { command: draft })}
									disabled={saving || draft === configured.command}
								>
									{saving ? t("common.saving") : t("common.save")}
								</Button>
								<Button
									 variant="outline"
									onClick={() => void updateEditor(editor.id, { command: "", enabled: false })}
									disabled={saving || (!configured.command && !configured.enabled)}
								>
									{t("editors.clear")}
								</Button>
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}
