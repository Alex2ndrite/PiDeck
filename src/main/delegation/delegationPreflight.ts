import {
	isDelegationToolAllowlistSafe,
	resolveDelegationCapabilityProfile,
} from "../../shared/delegationCapability";
import type {
	AvailableModel,
	DelegationPreflightCheck,
	DelegationPreflightInput,
	DelegationPreflightReport,
	Project,
} from "../../shared/types";

/**
 * Preflight 依赖（全部以函数注入，便于在不启动 Electron / pi 的情况下单测）。
 * 每个依赖抛错都被视为「该项检查失败」，而不是让整个预检崩掉。
 */
export type DelegationPreflightDeps = {
	/** 目标工作目录所属项目（worktree 模式下仍以 parent 项目为根做检查）。 */
	resolveProject: (projectId: string) => Project | undefined;
	/** 目录是否存在（cwd 检查）。 */
	directoryExists: (path: string) => Promise<boolean>;
	/** pi 可执行文件是否可用（PiLocator.check 适配）。 */
	checkPiInstalled: () => Promise<{ installed: boolean; version?: string; error?: string }>;
	/** 当前可用模型（pi --list-models 缓存适配）。 */
	listAvailableModels: () => Promise<AvailableModel[]>;
	/** 已配置凭据的 provider 名（auth.json + models.json 中带 apiKey 的 provider）。 */
	listAuthenticatedProviders: () => Promise<string[]>;
	/** 目标目录是否是 Git 仓库（worktree 模式所需）。 */
	isGitRepository: (path: string) => Promise<boolean>;
};

export type DelegationPreflightRequest = DelegationPreflightInput & {
	/** parent 会话所属项目（child 的 cwd 起点；worktree 模式下由它派生工作树）。 */
	projectId: string;
};

function check(
	id: DelegationPreflightCheck["id"],
	status: DelegationPreflightCheck["status"],
	detail?: string,
): DelegationPreflightCheck {
	return detail ? { id, status, detail } : { id, status };
}

function normalizeProviderName(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * Spawn 前预检：cwd / pi / 模型 / provider 凭据 / 能力档 / worktree。
 *
 * 语义约定：
 * - `fail` 阻断创建（缺目录、pi 不可用、模型不在可用列表、worktree 前置不满足）；
 * - `warn` 只提示不阻断（provider 未配置凭据——本地 provider 或 pi 侧环境变量鉴权仍可能可用）；
 * - `skip` 表示本次配置不涉及该项（未指定模型 / 共享工作区）。
 *
 * 该函数只做判定与聚合，不写任何状态，也不启动 pi 子进程。
 */
export async function runDelegationPreflight(
	request: DelegationPreflightRequest,
	deps: DelegationPreflightDeps,
): Promise<DelegationPreflightReport> {
	const checks: DelegationPreflightCheck[] = [];
	const project = deps.resolveProject(request.projectId);

	// cwd：项目记录缺失或目录已被删除时，child 一定 spawn 失败，直接 fail。
	if (!project) {
		checks.push(check("cwd", "fail", request.projectId));
	} else {
		const exists = await deps.directoryExists(project.path).catch(() => false);
		checks.push(check("cwd", exists ? "pass" : "fail", project.path));
	}

	// pi 可执行文件：PiDeck 唯一的 agent runtime，缺失时不必再往下花时间。
	const piStatus = await deps.checkPiInstalled().catch((error: unknown) => ({
		installed: false,
		version: undefined,
		error: error instanceof Error ? error.message : String(error),
	}));
	checks.push(check("pi", piStatus.installed ? "pass" : "fail", piStatus.version ?? piStatus.error));

	// 模型 + provider 凭据：未显式指定模型时跳过（child 继承 PiDeck/pi 的默认模型）。
	if (!request.model) {
		checks.push(check("model", "skip"));
		checks.push(check("provider", "skip"));
	} else {
		const target = request.model;
		const models = await deps.listAvailableModels().catch(() => [] as AvailableModel[]);
		const available = models.some(
			(model) =>
				normalizeProviderName(model.provider) === normalizeProviderName(target.provider)
				&& model.id === target.modelId,
		);
		checks.push(check("model", available ? "pass" : "fail", `${target.provider}/${target.modelId}`));
		const providers = await deps.listAuthenticatedProviders().catch(() => [] as string[]);
		const authenticated = providers.some(
			(provider) => normalizeProviderName(provider) === normalizeProviderName(target.provider),
		);
		// 未命中不代表不可用（环境变量 / 本地 provider 由 pi 自行解析），因此只 warn。
		checks.push(check("provider", authenticated ? "pass" : "warn", target.provider));
	}

	// 能力档：白名单里不允许出现未知或写能力工具，否则「只读」承诺是假的。
	const profile = resolveDelegationCapabilityProfile(request.role);
	const capabilitySafe = profile.writable || isDelegationToolAllowlistSafe(profile.allowedTools);
	checks.push(check(
		"capability",
		capabilitySafe ? "pass" : "fail",
		profile.writable ? "writer" : profile.allowedTools.join(","),
	));

	// worktree：只有 implement + worktree 模式才需要 Git 仓库；共享工作区直接跳过。
	if (request.workspaceMode !== "worktree") {
		checks.push(check("worktree", "skip"));
	} else if (!project) {
		checks.push(check("worktree", "fail", request.projectId));
	} else {
		const isRepo = await deps.isGitRepository(project.path).catch(() => false);
		checks.push(check("worktree", isRepo ? "pass" : "fail", project.path));
	}

	return { ok: checks.every((item) => item.status !== "fail"), checks };
}

/** 汇总失败项 id，供日志与错误信息使用（不含用户可见文案）。 */
export function failedDelegationPreflightIds(report: DelegationPreflightReport): string[] {
	return report.checks.filter((item) => item.status === "fail").map((item) => item.id);
}
