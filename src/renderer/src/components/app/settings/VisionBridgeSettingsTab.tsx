/**
 * 视觉桥设置页（设置弹框 → 视觉桥 tab）。
 *
 * 数据流：挂载时经 vision:get-config 拉取「当前配置」，模型选择复用会话的
 * ModelPicker（数据源 projects.listModels = models.json + auth.json + 内置目录全量模型，
 * 支持/不支持视觉由用户自行判断，不做能力过滤）；保存时经 vision:save-config
 * 白名单校验后写回 ~/.pi/agent/pi-deck-vision.json（pi-deck-vision 扩展运行时读取同一文件）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { t } from "../../../i18n";
import { desktopApi } from "../../../desktopApi";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import { Label } from "../../ui-shadcn/label";
import { Textarea } from "../../ui-shadcn/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../ui-shadcn/select";
import { Switch } from "../../ui-shadcn/switch";
import { ModelPicker } from "../../session/ComposerComponents";
import type { AvailableModel, VisionBridgeConfig, VisionBridgeState } from "../../../../../shared/types";
import { SettingsSection } from "./SettingsStorageTab";

/** 与扩展 DEFAULT_PROMPT 保持一致（恢复默认按钮用）。 */
const DEFAULT_PROMPT =
	"请详细描述这张图片的内容。如果图片中有文字（代码、报错、UI 文案、文档等），请完整准确地转录所有可见文字；如果是图表，请说明类型、坐标轴含义和关键数值；如果涉及界面，请描述布局与元素。输出使用中文。";

/** 配置文件路径（来自主进程返回的 configDir，与扩展读取路径一致）。 */
function configFilePath(configDir: string): string {
	return `${configDir}/pi-deck-vision.json`;
}

export function VisionBridgeSettingsTab() {
	const [state, setState] = useState<VisionBridgeState | null>(null);
	const [draft, setDraft] = useState<VisionBridgeConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);

	// 挂载时拉取配置；模型列表由 ModelPicker 打开时按需加载（与会话模型选择器同源）
	useEffect(() => {
		let mounted = true;
		desktopApi.config
			.visionGetConfig()
			.then((loaded) => {
				if (!mounted) return;
				setState(loaded);
				setDraft(loaded.config ?? { enabled: true, provider: "", model: "" });
				setLoading(false);
			})
			.catch(() => {
				if (mounted) setLoading(false);
			});
		return () => {
			mounted = false;
		};
	}, []);

	const updateDraft = (patch: Partial<VisionBridgeConfig>) => {
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
		setNotice(null);
	};

	// 打开模型选择器时拉取全量模型（复用现有 ModelPicker 的数据源）
	const [models, setModels] = useState<AvailableModel[]>([]);
	const openPicker = async () => {
		try {
			const list = await desktopApi.projects.listModels(undefined);
			setModels(list);
			setPickerOpen(true);
		} catch {
			// 列表加载失败不阻断：仍可打开（空列表由 ModelPicker 的 empty 文案兜底）
			setModels([]);
			setPickerOpen(true);
		}
	};

	const onPickModel = (model: AvailableModel) => {
		updateDraft({ provider: model.provider, model: model.id });
		setPickerOpen(false);
	};

	const selectedModelLabel = useMemo(() => {
		if (!draft?.provider || !draft?.model) return "";
		return `${draft.provider}/${draft.model}`;
	}, [draft?.provider, draft?.model]);

	const onSave = async () => {
		if (!draft) return;
		setSaving(true);
		setNotice(null);
		try {
			const result = await desktopApi.config.visionSaveConfig(draft);
			setNotice(
				result.ok
					? { tone: "ok", text: t("settings.vision.saved") }
					: { tone: "error", text: `${t("settings.vision.saveFailed")}：${result.error ?? ""}` },
			);
		} catch (error) {
			setNotice({ tone: "error", text: `${t("settings.vision.saveFailed")}：${String(error)}` });
		} finally {
			setSaving(false);
		}
	};

	if (loading) return <div className="settings-panel min-w-0" />;

	return (
		<div className="min-w-0">
			<SettingsSection title={t("settings.vision.section")} description={t("settings.vision.sectionDesc")}>
				{/* 总开关 */}
				<Label className="setting-switch-row">
					<span>
						<strong>{t("settings.vision.enabled")}</strong>
						<small>{t("settings.vision.enabledDesc")}</small>
					</span>
					<Switch
						checked={draft?.enabled ?? true}
						onCheckedChange={(checked) => updateDraft({ enabled: checked })}
					/>
				</Label>

				{/* 视觉模型选择：复用会话的 ModelPicker（全量模型，含 auth.json），
				    是否支持视觉由用户自行判断，不做能力标注/过滤 */}
				<div className="setting-field">
					<span>
						<strong>{t("settings.vision.model")}</strong>
						<small>{t("settings.vision.modelDesc")}</small>
					</span>
					<Button
						type="button"
						variant="outline"
						className="w-full justify-between font-mono text-control"
						onClick={openPicker}
					>
						<span className={selectedModelLabel ? "" : "text-muted-foreground"}>
							{selectedModelLabel || t("settings.vision.modelPlaceholder")}
						</span>
						<ChevronsUpDown size={14} className="opacity-60" aria-hidden />
					</Button>
					{selectedModelLabel && (
						<small className="flex items-center gap-1" style={{ color: "var(--color-text-tertiary)" }}>
							<Check size={12} aria-hidden />
							{t("settings.vision.modelSelectedHint")}
						</small>
					)}
				</div>

				{/* API 格式（一般自动推断） */}
				<div className="setting-field">
					<span>
						<strong>{t("settings.vision.api")}</strong>
						<small>{t("settings.vision.apiDesc")}</small>
					</span>
					<Select
						value={draft?.api ?? "auto"}
						onValueChange={(api) => updateDraft({ api: api === "auto" ? undefined : (api as VisionBridgeConfig["api"]) })}
					>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="auto">{t("settings.vision.apiAuto")}</SelectItem>
							<SelectItem value="openai-completions">{t("settings.vision.apiOpenai")}</SelectItem>
							<SelectItem value="anthropic-messages">{t("settings.vision.apiAnthropic")}</SelectItem>
							<SelectItem value="google-generative-ai">{t("settings.vision.apiGoogle")}</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* 可选覆盖项 */}
				<div className="setting-field">
					<span>
						<strong>{t("settings.vision.baseUrl")}</strong>
						<small>{t("settings.vision.baseUrlDesc")}</small>
					</span>
					<Input
						value={draft?.baseUrl ?? ""}
						placeholder="https://open.bigmodel.cn/api/paas/v4"
						onChange={(event) => updateDraft({ baseUrl: event.target.value || undefined })}
					/>
				</div>

				<div className="setting-field">
					<span>
						<strong>{t("settings.vision.apiKey")}</strong>
						<small>{t("settings.vision.apiKeyDesc")}</small>
					</span>
					<Input
						type="password"
						value={draft?.apiKey ?? ""}
						onChange={(event) => updateDraft({ apiKey: event.target.value || undefined })}
					/>
				</div>

				{/* 数值参数 */}
				<div className="setting-field" style={{ display: "flex", gap: "var(--space-4)" }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<strong>{t("settings.vision.maxTokens")}</strong>
						<Input
							type="number"
							min={1}
							max={32768}
							value={draft?.maxTokens ?? 1024}
							onChange={(event) => updateDraft({ maxTokens: Number(event.target.value) || undefined })}
						/>
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						<strong>{t("settings.vision.concurrency")}</strong>
						<Input
							type="number"
							min={1}
							max={16}
							value={draft?.concurrency ?? 2}
							onChange={(event) => updateDraft({ concurrency: Number(event.target.value) || undefined })}
						/>
					</div>
				</div>

				{/* 提示词模板 + 恢复默认 */}
				<div className="setting-field">
					<span>
						<strong>{t("settings.vision.promptTemplate")}</strong>
						<small>{t("settings.vision.promptTemplateDesc")}</small>
					</span>
					<Textarea
						rows={6}
						value={draft?.promptTemplate ?? DEFAULT_PROMPT}
						onChange={(event) => updateDraft({ promptTemplate: event.target.value })}
					/>
					<div>
						<Button variant="outline" size="sm" onClick={() => updateDraft({ promptTemplate: DEFAULT_PROMPT })}>
							{t("settings.vision.promptDefault")}
						</Button>
					</div>
				</div>
			</SettingsSection>

			{/* 配置文件位置说明：扩展与 PiDeck 共享 */}
			<SettingsSection title={t("settings.vision.configFile")} description={t("settings.vision.configFileDesc")}>
				<div className="setting-field">
					<code style={{ fontSize: "var(--font-size-caption)", color: "var(--color-text-tertiary)" }}>
						{state ? configFilePath(state.configDir) : ""}
					</code>
				</div>
			</SettingsSection>

			{/* 保存区 */}
			<div className="settings-footer-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
				<Button onClick={onSave} disabled={saving || !draft?.provider || !draft?.model}>
					{saving ? "…" : t("settings.vision.save")}
				</Button>
				{notice && (
					<small
						style={{
							color: notice.tone === "ok" ? "var(--color-success, #16a34a)" : "var(--color-danger, #dc2626)",
						}}
					>
						{notice.text}
					</small>
				)}
			</div>

			{/* 模型选择弹层：与会话模型选择器同一组件，行为一致 */}
			{pickerOpen && (
				<ModelPicker
					models={models}
					current={draft?.provider ? { provider: draft.provider, modelId: draft.model } : undefined}
					favoriteModels={[]}
					onToggleFavorite={() => undefined}
					onPick={onPickModel}
					onClose={() => setPickerOpen(false)}
				/>
			)}
		</div>
	);
}
