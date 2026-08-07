import { Button } from "../components/ui-shadcn/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui-shadcn/table";
import { Tabs, TabsList, TabsTrigger } from "../components/ui-shadcn/tabs";
import { useState } from "react";
import { Check, FileEdit, Pencil, ShoppingBag, ToggleLeft, ToggleRight, Trash2, X, Store, Globe } from "lucide-react";
import type {
	CreatePiSkillInput,
	PiSkillListResult,
	PiSkillLocation,
	PiSkillSummary,
} from "../../../shared/types";
import { t } from "../i18n";
import { SkillStoreTab } from "./SkillStoreTab";
import { SkillHubStorePanel } from "./SkillHubStorePanel";
import { Input } from "../components/ui-shadcn/input";
import { Textarea } from "../components/ui-shadcn/textarea";
import { Label } from "../components/ui-shadcn/label";

export function SkillsTab(props: {
	data: PiSkillListResult;
	loading: boolean;
	creating: boolean;
	newName: string;
	newDescription: string;
	newLocationId: PiSkillLocation["id"];
	onRefresh: () => void;
	onOpenRoot: () => void;
	onChangeNewName: (value: string) => void;
	onChangeNewDescription: (value: string) => void;
	onChangeNewLocation: (value: PiSkillLocation["id"]) => void;
	onCreate: () => void;
	onToggle: (skill: PiSkillSummary, enabled: boolean) => void;
	onDelete: (skill: PiSkillSummary) => void;
	onEdit: (skill: PiSkillSummary) => void;
	onRename: (skill: PiSkillSummary, newName: string) => Promise<void>;
}) {
	const { data } = props;
	// 一级 tab：本地 / 商店
	const [skillTab, setSkillTab] = useState<"local" | "store">("local");
	// 二级 tab（商店内）：选择供应商
	const [storeSource, setStoreSource] = useState<"promptchat" | "skillhub">("skillhub");
	const [locationPickerOpen, setLocationPickerOpen] = useState(false);
	const canCreate = props.newName.trim() && props.newDescription.trim();
	// 按选中的位置目录过滤 skill 列表
	// 新建技能的位置只影响保存目标，不应把其他目录已有的技能从列表中隐藏。
	const visibleSkills = data.skills;
	const selectedLocation =
		data.locations.find((location) => location.id === props.newLocationId) ??
		data.locations[0];
	return (
		<div className="skills-tab">
		{/* 一级 tab：本地 / 商店（shadcn Tabs） */}
		<Tabs
			value={skillTab}
			onValueChange={(v) => { if (v === "local" || v === "store") setSkillTab(v); }}
			className="gap-0"
		>
			<TabsList className="w-fit">
				<TabsTrigger value="local" onClick={() => props.onRefresh()}>
					{t("config.nav.skills")}
				</TabsTrigger>
				<TabsTrigger value="store">
					<ShoppingBag size={14} strokeWidth={1.8} />
					{t("config.promptStoreTab")}
				</TabsTrigger>
			</TabsList>
		</Tabs>

			{skillTab === "store" ? (
				<div className="skills-store-content">
					{/* 二级 tab：供应商切换（shadcn Tabs，紧凑变体） */}
					<Tabs
						value={storeSource}
						onValueChange={(v) => { if (v === "skillhub" || v === "promptchat") setStoreSource(v); }}
						className="gap-0"
					>
						<TabsList className="w-fit">
							<TabsTrigger value="skillhub" className="px-3 py-1 text-xs">
								<Store size={14} strokeWidth={1.8} />
								{t("config.tabs.skillHub")}
							</TabsTrigger>
							<TabsTrigger value="promptchat" className="px-3 py-1 text-xs">
								<Globe size={14} strokeWidth={1.8} />
								Prompt.chat
							</TabsTrigger>
						</TabsList>
					</Tabs>
					{storeSource === "skillhub" ? (
						<SkillHubStorePanel />
					) : (
						<SkillStoreTab
							onImported={props.onRefresh}
							locationId={props.newLocationId}
						/>
					)}
				</div>
			) : (
				<>
					<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<span className="font-mono text-xs tabular-nums text-text-tertiary">
						{t("config.count.skills", { count: visibleSkills.length })}
					</span>
					<small className="skills-restart-hint">
						{t("config.restartHint")}
					</small>
				</div>
				<div className="skills-toolbar-actions flex items-center gap-1.5">
					{/* 与扩展页/设置页统一为 sm 控件高度 */}
					<Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.loading}>
						{t("common.refresh")}
					</Button>
					<Button variant="secondary" size="sm" onClick={props.onOpenRoot}>
						{t("config.openFolder")}
					</Button>
				</div>
			</div>

			<section className="skill-create-card">
				<strong>{t("config.createSkill")}</strong>
				<div className="skill-create-grid">
					<Label>
						<span>{t("config.name")}</span>
						<Input
							value={props.newName}
							placeholder={t("config.skillNamePlaceholder")}
							onChange={(event) => props.onChangeNewName(event.target.value)}
						/>
					</Label>
					<Label>
						<span>{t("config.location")}</span>
						<div
							className="skill-location-picker"
							onBlur={() => {
								// 先让菜单项的 mouseDown 完成选中，再关闭弹层；否则点击选项时可能只触发焦点切换，表现为不回填。
								window.setTimeout(() => setLocationPickerOpen(false), 80);
							}}
						>
							<button
								type="button"
								className={locationPickerOpen ? "open" : ""}
								onMouseDown={(event) => {
									event.preventDefault();
									setLocationPickerOpen((open) => !open);
								}}
							>
								<span>{selectedLocation?.label ?? t("config.chooseFolder")}</span>
								<b>⌄</b>
							</button>
							{locationPickerOpen && (
								<div className="skill-location-menu">
									{data.locations.map((location) => (
										<button
											key={location.id}
											type="button"
											className={location.id === props.newLocationId ? "active" : ""}
											onMouseDown={(event) => {
												event.preventDefault();
												// 自定义下拉只改变保存位置，不立即创建，避免用户误触后写入文件。
												props.onChangeNewLocation(location.id);
												setLocationPickerOpen(false);
											}}
										>
											<strong>{location.label}</strong>
											<small>{location.path}</small>
										</button>
									))}
								</div>
							)}
						</div>
					</Label>
				</div>
				<Label className="skill-description-field">
					<span>{t("config.description")}</span>
					<Textarea
						value={props.newDescription}
						placeholder={t("config.skillUseWhenPlaceholder")}
						onChange={(event) => props.onChangeNewDescription(event.target.value)}
					/>
				</Label>
				<Button size="sm" variant="default"
					onClick={props.onCreate}
					disabled={!canCreate || props.creating}
				>
					{props.creating ? t("config.creatingSkill") : t("config.addSkill")}
				</Button>
			</section>

			<div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-panel">
				{visibleSkills.length === 0 ? (
					<div className="py-12 text-center text-control text-text-tertiary">{t("config.emptySkills")}</div>
				) : (
					<Table>
						<TableHeader><TableRow><TableHead>{t("config.name")}</TableHead><TableHead>{t("config.description")}</TableHead><TableHead>{t("config.extensionPath")}</TableHead><TableHead className="w-28 text-right">{t("config.actions")}</TableHead></TableRow></TableHeader>
						<TableBody>
						{visibleSkills.map((skill) => (
						<TableRow key={skill.id}><TableCell colSpan={4} className="p-0"><SkillCard
							skill={skill}
							onToggle={props.onToggle}
							onDelete={props.onDelete}
							onEdit={props.onEdit}
							onRename={props.onRename}
						/></TableCell></TableRow>
						))}
						</TableBody>
					</Table>
				)}
			</div>
		</>
			)}
		</div>
	);
}

function SkillCard(props: {
	skill: PiSkillSummary;
	onToggle: (skill: PiSkillSummary, enabled: boolean) => void;
	onDelete: (skill: PiSkillSummary) => void;
	onEdit: (skill: PiSkillSummary) => void;
	onRename: (skill: PiSkillSummary, newName: string) => Promise<void>;
}) {
	const { skill } = props;
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(skill.name);
	const [renameBusy, setRenameBusy] = useState(false);

	const handleRename = async () => {
		if (renameBusy || !renameValue.trim() || renameValue.trim() === skill.name) {
			setRenaming(false);
			return;
		}
		setRenameBusy(true);
		try {
			await props.onRename(skill, renameValue.trim());
			setRenaming(false);
		} finally {
			setRenameBusy(false);
		}
	};

	return (
		<article className="session-card skill-card">
			<div className="session-card-display">
				<div className="session-card-inner skill-card-main">
					<div className="session-card-title skill-title-row">
						{renaming ? (
							<div className="skill-rename-inline">
								<Input
									value={renameValue}
									onChange={(e) => setRenameValue(e.target.value)}
									onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); if (e.key === "Escape") setRenaming(false); }}
									autoFocus
									disabled={renameBusy}
								/>
								<Button variant="ghost" size="icon-sm" className="size-7" onClick={handleRename} disabled={renameBusy} title={t("common.confirm")}>
									<Check size={14} strokeWidth={2} />
								</Button>
								<Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setRenaming(false)} disabled={renameBusy} title={t("common.cancel")}>
									<X size={14} strokeWidth={2} />
								</Button>
							</div>
						) : (
							<strong className="min-w-0 truncate">{skill.name}</strong>
						)}
						<div className="skill-badges">
							<span className={`skill-state ${skill.enabled ? "enabled" : "disabled"}`}>
								{skill.enabled ? t("common.enabled") : t("common.disabled")}
							</span>
							{!skill.valid && <span className="skill-state invalid">{t("config.needsFix")}</span>}
						</div>
					</div>
					<small className="min-w-0 truncate">{skill.description || t("config.skillDescriptionMissing")}</small>
					<small className="min-w-0 truncate">{skill.sourceLabel} · {skill.path}</small>
					{skill.warnings.length > 0 && (
						<ul className="skill-warnings">
							{skill.warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					)}
				</div>
				<div className="prompts-list-item-actions">
					<Button variant="ghost" size="icon-sm" className="size-7"
						onClick={() => props.onToggle(skill, !skill.enabled)}
						title={skill.enabled ? t("common.disable") : t("common.enabled")}
						style={skill.enabled ? { color: "var(--color-accent)" } : undefined}
					>
						{skill.enabled ? <ToggleRight size={18} strokeWidth={1.8} /> : <ToggleLeft size={18} strokeWidth={1.8} />}
					</Button>
					<Button variant="ghost" size="icon-sm" className="size-7"
						onClick={() => props.onEdit(skill)}
						title={t("common.edit")}
					>
						<Pencil size={14} strokeWidth={1.8} />
					</Button>
					<Button variant="ghost" size="icon-sm" className="size-7"
						onClick={() => { setRenaming(true); setRenameValue(skill.name); }}
						title={t("common.rename")}
					>
						<FileEdit size={14} strokeWidth={1.8} />
					</Button>
					<Button variant="ghost" size="icon-sm" className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={() => props.onDelete(skill)}
						title={t("common.delete")}
					>
						<Trash2 size={14} strokeWidth={1.8} />
					</Button>
				</div>
			</div>
		</article>
	);
}

export type { CreatePiSkillInput };
