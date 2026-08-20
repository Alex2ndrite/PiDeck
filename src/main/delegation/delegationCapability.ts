import { resolveDelegationToolAllowlistForRole } from "../../shared/delegationCapability";
import type { DelegationRecord } from "../../shared/types";

/** 只需要按 child 会话查关系，便于测试注入替身。 */
export type DelegationRelationLookup = {
	findByChild(childSessionId: string): DelegationRecord | undefined;
};

/**
 * 解析某个会话（若它是 delegation child）在 spawn pi 时应使用的工具白名单。
 *
 * 为什么放在 spawn 边界而不是提示词：
 * - 白名单由 role 推导，重启 / reattach 重新 spawn 时同样生效，不依赖任何一次性状态；
 * - read-only 角色即使模型「想」改文件也拿不到 edit/write/bash 工具。
 *
 * 容错：DelegationStore 尚未 load（启动早期）或查询抛错时返回 undefined，
 * 即退回 pi 默认工具集——预检失败不应该把会话启动整体打死，
 * 相关风险由 delegationsCreate 的 preflight 与日志覆盖。
 */
export function resolveDelegationToolAllowlist(
	store: DelegationRelationLookup | undefined,
	sessionKey: string | undefined,
): readonly string[] | undefined {
	if (!store || !sessionKey) return undefined;
	try {
		const relation = store.findByChild(sessionKey);
		if (!relation) return undefined;
		return resolveDelegationToolAllowlistForRole(relation.role);
	} catch {
		return undefined;
	}
}
