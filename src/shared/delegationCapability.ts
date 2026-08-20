import type {
	DelegationCapabilityProfile,
	DelegationRole,
} from "./types/delegation";

/**
 * Pi 内置工具名（`pi --tools` 白名单可用的名字）。
 * 只读档必须从这里挑选，避免把不存在的名字写进白名单后静默失效。
 */
export const PI_BUILT_IN_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;

/** Pi 内置的写能力工具：只读档的白名单里出现任何一个都视为契约错误。 */
export const PI_MUTATING_TOOLS = ["edit", "write", "bash"] as const;

/**
 * PiDeck 内置扩展提供的、允许出现在只读白名单里的工具。
 * `ask_question` 让子会话仍能向用户提问（不产生写副作用）；
 * pi 对白名单里未注册的名字直接忽略，因此扩展被用户关掉也不会导致启动失败。
 */
export const PI_DECK_READ_ONLY_EXTENSION_TOOLS = ["ask_question"] as const;

/** 只读档工具集：inspect(read) + grep + glob(find/ls) + 提问，刻意不含 bash（bash 可写文件）。 */
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", ...PI_DECK_READ_ONLY_EXTENSION_TOOLS] as const;

/**
 * 角色 → 能力档。
 *
 * 设计规则（P4）：
 * - explore / review / consult 是**能力层面不可写**：pi 侧以工具白名单收敛，不依赖提示词自律；
 * - implement 是 writer：不下发白名单，继承 pi 默认工具集（read/bash/edit/write + 扩展工具），
 *   因为一旦写死白名单，pi 后续新增的编辑类工具就会被 PiDeck 静默锁掉。
 *
 * 档位只由 role 推导，因此已有 DelegationRecord 无需迁移即可获得能力约束，
 * 重启后重新 spawn 也会得到同一档位。
 */
const PROFILES: Readonly<Record<DelegationRole, DelegationCapabilityProfile>> = {
	explore: { role: "explore", writable: false, allowedTools: READ_ONLY_TOOLS },
	review: { role: "review", writable: false, allowedTools: READ_ONLY_TOOLS },
	consult: { role: "consult", writable: false, allowedTools: READ_ONLY_TOOLS },
	implement: { role: "implement", writable: true, allowedTools: [] },
};

/** 解析角色对应的能力档（纯函数，主进程 / 渲染层共用同一真相）。 */
export function resolveDelegationCapabilityProfile(role: DelegationRole): DelegationCapabilityProfile {
	return PROFILES[role];
}

/**
 * 能力档 → pi 工具白名单（用于 `pi --tools a,b,c`）。
 * writer 档返回 undefined 表示「不下发 --tools」，与「白名单为空」语义不同：
 * 空白名单会让 pi 关掉所有工具，属于危险的误用。
 */
export function resolveDelegationToolAllowlistForRole(role: DelegationRole): readonly string[] | undefined {
	const profile = resolveDelegationCapabilityProfile(role);
	if (profile.writable) return undefined;
	return profile.allowedTools.length > 0 ? profile.allowedTools : undefined;
}

/** 白名单是否只包含已知且非写能力的工具名（契约自检，preflight 会消费）。 */
export function isDelegationToolAllowlistSafe(allowedTools: readonly string[]): boolean {
	const known = new Set<string>([...PI_BUILT_IN_TOOLS, ...PI_DECK_READ_ONLY_EXTENSION_TOOLS]);
	const mutating = new Set<string>(PI_MUTATING_TOOLS);
	return allowedTools.every((tool) => known.has(tool) && !mutating.has(tool));
}
