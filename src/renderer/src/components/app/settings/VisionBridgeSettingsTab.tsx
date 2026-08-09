/**
 * 视觉桥设置页（设置弹框 → 视觉桥 tab）。
 *
 * 数据流：挂载时经 vision:get-config 拉取「当前配置」，模型选择复用会话的
 * ModelPicker（数据源 projects.listModels = models.json + auth.json + 内置目录全量模型，
 * 支持/不支持视觉由用户自行判断，不做能力过滤）；保存时经 vision:save-config
 * 白名单校验后写回 ~/.pi/agent/pi-deck-vision.json（pi-deck-vision 扩展运行时读取同一文件）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, RefreshCw, Trash2 } from "lucide-react";
import { t } from "../../../i18n";
import { desktopApi } from "../../../desktopApi";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import { Textarea } from "../../ui-shadcn/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../ui-shadcn/select";
import { ModelPicker } from "../../session/ComposerComponents";
import type {
	AvailableModel,
	VisionBridgeConfig,
	VisionBridgeState,
	VisionLogInfo,
} from "../../../../../shared/types";
import { SettingsSection } from "./SettingsStorageTab";
import { SettingRow, SettingSwitchRow } from "./SettingRows";

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
	// 运行日志（诊断“视觉桥走没走”）：挂载时拉一次，用户可手动刷新
	const [logInfo, setLogInfo] = useState<VisionLogInfo | null>(null);

	const loadLog = useCallback(async () => {
		try {
			setLogInfo(await desktopApi.config.visionGetLog());
		} catch {
			setLogInfo(null);
		}
	}, []);

	// 打开模型选择器时拉取全量模型（复用现有 ModelPicker 的数据源）；
	// 挂载时也拉一次（模型列表有全局缓存，开销小），用于展示当前已选模型的能力
	const [models, setModels] = useState<AvailableModel[]>([]);
	const loadModels = useCallback(async () => {
		try {
			setModels(await desktopApi.projects.listModels(undefined));
		} catch {
			setModels([]);
		}
	}, []);

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
		loadLog();
		loadModels();
		return () => {
			mounted = false;
		};
	}, [loadLog, loadModels]);

	// 注意：提前 return 必须在所有 hooks（useState/useCallback/useEffect/useMemo）之后，
	// 否则 loading 从 true→false 时 hooks 数量变化会触发 React 崩溃。
	const updateDraft = (patch: Partial<VisionBridgeConfig>) => {
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
		setNotice(null);
	};

	const openPicker = async () => {
		await loadModels();
		setPickerOpen(true);
	};

	const onPickModel = (model: AvailableModel) => {
		const patch: Partial<VisionBridgeConfig> = { provider: model.provider, model: model.id };
		// 按模型能力自动填充：maxTokens 建议 min(单次输出上限, 4096)（描述图片一般 4K 足够），
		// 只在用户未手动改过（默认 1024 或未设）时写入，避免覆盖用户自定义值
		if (typeof model.maxTokens === "number" && model.maxTokens > 0) {
			const suggested = Math.min(model.maxTokens, 4096);
			if (draft?.maxTokens === undefined || draft.maxTokens === 1024) {
				patch.maxTokens = suggested;
			}
		}
		// provider 本身是 URL（自定义网关）时自动作为 baseUrl，用户无需手动填
		if (!draft?.baseUrl && /^https?:\/\/[^\s]+$/i.test(model.provider)) {
			patch.baseUrl = model.provider.replace(/\/+$/, "");
		}
		updateDraft(patch);
		setPickerOpen(false);
	};

	const selectedModelLabel = useMemo(() => {
		if (!draft?.provider || !draft?.model) return "";
		return `${draft.provider}/${draft.model}`;
	}, [draft?.provider, draft?.model]);

	/** 当前配置对应的模型能力（模型列表来自 pi --list-models 全量输出） */
	const selectedModel = useMemo(
		() => models.find((m) => m.provider === draft?.provider && m.id === draft?.model),
		[models, draft?.provider, draft?.model],
	);

	/** token 数转人类可读：1048576→"1M"，67109→"65.5K"，204800→"200K" */
	const formatTokens = (n: number): string => {
		if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)}M`;
		if (n >= 1024) return `${Math.round(n / 1024)}K`;
		return String(n);
	};

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
				<SettingSwitchRow
					title={t("settings.vision.enabled")}
					description={t("settings.vision.enabledDesc")}
					checked={draft?.enabled ?? true}
					onChange={(checked) => updateDraft({ enabled: checked })}
				/>

				{/* 视觉模型选择：复用会话的 ModelPicker（全量模型，含 auth.json），
				    是否支持视觉由用户自行判断，不做能力标注/过滤 */}
				<SettingRow
					title={<span>{t("settings.vision.model")}</span>}
					description={
						selectedModelLabel ? (
							<>
								{selectedModel?.images === false ? (
									<span className="font-semibold text-destructive">{t("settings.vision.noImagesWarning")}</span>
								) : (
									<span className="inline-flex items-center gap-1">
										<Check size={12} aria-hidden />
										{t("settings.vision.modelSelectedHint")}
									</span>
								)}
								{/* 模型能力：来自 pi --list-models 的 context/max-out/thinking/images 列 */}
								<span className="flex flex-wrap gap-x-3 gap-y-1">
									{selectedModel ? (
										<>
											<span>
												{selectedModel.images === true
													? t("settings.vision.supportsImages")
													: selectedModel.images === false
														? t("settings.vision.unsupportedImages")
														: t("settings.vision.capabilityUnknown")}
											</span>
											{selectedModel.contextWindow !== undefined && (
												<span>{t("settings.vision.contextWindow", { size: formatTokens(selectedModel.contextWindow) })}</span>
											)}
											{selectedModel.maxTokens !== undefined && (
												<span>{t("settings.vision.outputCap", { size: formatTokens(selectedModel.maxTokens) })}</span>
											)}
											{selectedModel.reasoning && <span>{t("settings.vision.thinking")}</span>}
										</>
									) : (
										<span>{t("settings.vision.capabilityUnknown")}</span>
									)}
								</span>
							</>
						) : undefined
					}
				>
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
				</SettingRow>

				{/* API 格式（一般自动推断） */}
				<SettingRow
					title={<span>{t("settings.vision.api")}</span>}
					description={t("settings.vision.apiDesc")}
					alignEnd={false}
				>
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
				</SettingRow>

				{/* 可选覆盖项 */}
				<SettingRow
					title={<span>{t("settings.vision.baseUrl")}</span>}
					description={t("settings.vision.baseUrlDesc")}
					stacked
				>
					<Input
						value={draft?.baseUrl ?? ""}
						placeholder="https://open.bigmodel.cn/api/paas/v4"
						onChange={(event) => updateDraft({ baseUrl: event.target.value || undefined })}
					/>
				</SettingRow>

				<SettingRow
					title={<span>{t("settings.vision.apiKey")}</span>}
					description={t("settings.vision.apiKeyDesc")}
					stacked
				>
					<Input
						type="password"
						value={draft?.apiKey ?? ""}
						onChange={(event) => updateDraft({ apiKey: event.target.value || undefined })}
					/>
				</SettingRow>

				{/* 数值参数 */}
				<SettingRow
					title={<span>{t("settings.vision.maxTokens")}</span>}
					alignEnd={false}
				>
					<Input
						type="number"
						min={1}
						max={32768}
						value={draft?.maxTokens ?? 1024}
						onChange={(event) => updateDraft({ maxTokens: Number(event.target.value) || undefined })}
					/>
				</SettingRow>
				<SettingRow
					title={<span>{t("settings.vision.concurrency")}</span>}
					alignEnd={false}
				>
					<Input
						type="number"
						min={1}
						max={16}
						value={draft?.concurrency ?? 2}
						onChange={(event) => updateDraft({ concurrency: Number(event.target.value) || undefined })}
					/>
				</SettingRow>

				{/* 提示词模板 + 恢复默认 */}
				<SettingRow
					title={<span>{t("settings.vision.promptTemplate")}</span>}
					description={t("settings.vision.promptTemplateDesc")}
					stacked
				>
					<Textarea
						rows={6}
						value={draft?.promptTemplate ?? DEFAULT_PROMPT}
						onChange={(event) => updateDraft({ promptTemplate: event.target.value })}
					/>
					<div className="pt-2">
						<Button variant="outline" size="sm" onClick={() => updateDraft({ promptTemplate: DEFAULT_PROMPT })}>
							{t("settings.vision.promptDefault")}
						</Button>
					</div>
				</SettingRow>
			</SettingsSection>

			{/* 配置文件位置说明：扩展与 PiDeck 共享 */}
			<SettingsSection
				title={t("settings.vision.configFile")}
				description={
					<code className="break-all text-caption text-muted-foreground">
						{state ? configFilePath(state.configDir) : ""}
					</code>
				}
			/>

			{/* 运行记录诊断区：发一张图 → 回来刷新，即可确认视觉桥是否真的生效 */}
			<SettingsSection title={t("settings.vision.logSection")} description={t("settings.vision.logSectionDesc")}>
				<div className="flex items-center gap-2 px-0.5 pb-2">
					<Button variant="outline" size="sm" onClick={loadLog}>
						<RefreshCw size={12} aria-hidden />
						{t("settings.vision.logRefresh")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={async () => {
							await desktopApi.config.visionClearLog();
							loadLog();
						}}
					>
						<Trash2 size={12} aria-hidden />
						{t("settings.vision.logClear")}
					</Button>
					{logInfo?.exists && logInfo.size > 0 && (
						<small className="text-muted-foreground">
							{t("settings.vision.logSize", { size: Math.max(1, Math.round(logInfo.size / 1024)) })}
							{logInfo.truncated ? ` ${t("settings.vision.logTruncated")}` : ""}
						</small>
					)}
				</div>
				<pre className="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg-muted p-3 text-caption leading-relaxed text-text-secondary">
					{logInfo?.exists && logInfo.content ? logInfo.content : t("settings.vision.logEmpty")}
				</pre>
			</SettingsSection>

			{/* 保存区 */}
			<div className="flex items-center gap-3 px-0.5 pt-4">
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
