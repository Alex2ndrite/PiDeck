import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, ShieldCheck, ShieldOff, XCircle } from "lucide-react";
import type {
	DelegationCapabilityProfile,
	DelegationPreflightCheck,
	DelegationPreflightCheckId,
	DelegationPreflightReport,
	DelegationPreflightStatus,
} from "../../../../shared/types";
import { t } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import { Button } from "../ui-shadcn/button";

const CHECK_LABEL_KEYS: Record<DelegationPreflightCheckId, TranslationKey> = {
	cwd: "delegation.preflightCheck.cwd",
	pi: "delegation.preflightCheck.pi",
	model: "delegation.preflightCheck.model",
	provider: "delegation.preflightCheck.provider",
	capability: "delegation.preflightCheck.capability",
	worktree: "delegation.preflightCheck.worktree",
};

const STATUS_LABEL_KEYS: Record<DelegationPreflightStatus, TranslationKey> = {
	pass: "delegation.preflightStatus.pass",
	warn: "delegation.preflightStatus.warn",
	fail: "delegation.preflightStatus.fail",
	skip: "delegation.preflightStatus.skip",
};

/** 状态 → 语义色 + 图标；只读/可写徽标复用同一套 tone，保持与 Git/会话状态观感一致。 */
function StatusIcon(props: { status: DelegationPreflightStatus }) {
	if (props.status === "pass") return <CheckCircle2 size={14} className="text-emerald-500" aria-hidden="true" />;
	if (props.status === "warn") return <AlertTriangle size={14} className="text-amber-500" aria-hidden="true" />;
	if (props.status === "fail") return <XCircle size={14} className="text-destructive" aria-hidden="true" />;
	return <MinusCircle size={14} className="text-muted-foreground" aria-hidden="true" />;
}

function CheckRow(props: { check: DelegationPreflightCheck }) {
	return (
		<li className="flex items-start gap-2">
			<span className="mt-0.5 shrink-0"><StatusIcon status={props.check.status} /></span>
			<span className="flex-1 leading-5">
				<span className="font-medium">{t(CHECK_LABEL_KEYS[props.check.id])}</span>
				<span className="text-muted-foreground">
					{` · ${t(STATUS_LABEL_KEYS[props.check.status])}`}
					{props.check.detail ? ` · ${props.check.detail}` : ""}
				</span>
			</span>
		</li>
	);
}

/**
 * 能力档 + 启动预检的展示面板。
 *
 * 透明性要求（Delegation Plan §7）：模型 / 能力上限 / 环境前置必须在创建前对用户可见，
 * 因此面板同时呈现「这个 child 能做什么」和「现在能不能创建」。
 */
export function DelegationCapabilityPanel(props: {
	profile: DelegationCapabilityProfile;
	report: DelegationPreflightReport | undefined;
	loading: boolean;
	failed: boolean;
	onRetry: () => void;
}) {
	const blocked = props.report ? !props.report.ok : false;
	return (
		<div className="grid gap-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
			<div className="flex items-center gap-2">
				{props.profile.writable
					? <ShieldOff size={14} className="text-amber-500" aria-hidden="true" />
					: <ShieldCheck size={14} className="text-emerald-500" aria-hidden="true" />}
				<span className="font-medium">{t("delegation.capability")}</span>
				<span className="text-muted-foreground">
					{props.profile.writable ? t("delegation.capabilityWriter") : t("delegation.capabilityReadOnly")}
				</span>
			</div>
			<p className="text-muted-foreground">
				{props.profile.writable
					? t("delegation.capabilityWriterTools")
					: t("delegation.capabilityTools", { tools: props.profile.allowedTools.join(", ") })}
			</p>
			<div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
				<span className="font-medium">{t("delegation.preflight")}</span>
				{props.loading
					? <span className="flex items-center gap-1 text-muted-foreground"><Loader2 size={12} className="animate-spin" aria-hidden="true" />{t("delegation.preflightChecking")}</span>
					: <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={props.onRetry}>{t("delegation.preflightRetry")}</Button>}
			</div>
			{props.report ? (
				<ul className="grid gap-1">
					{props.report.checks.map((check) => <CheckRow key={check.id} check={check} />)}
				</ul>
			) : null}
			{props.failed ? <p className="text-destructive">{t("delegation.preflightError")}</p> : null}
			{blocked ? <p className="text-destructive">{t("delegation.preflightBlocked")}</p> : null}
		</div>
	);
}
