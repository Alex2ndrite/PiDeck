/**
 * 会话 Tab 栏的固定（pin）与拖拽排序纯逻辑。
 *
 * 不变量：tabs 数组始终为 [pinned...] + [normal...]（固定在前），
 * 由本模块的操作维护；渲染层直接按 tabs 顺序展示即可。
 */

/** 切换固定状态：pin 后移入固定区末尾；unpin 后移入普通区开头（紧跟固定区）。 */
export function togglePinSessionTab(
	tabs: readonly string[],
	pinned: readonly string[],
	sessionId: string,
): { tabs: string[]; pinned: string[] } {
	const isPinned = pinned.includes(sessionId);
	const nextPinned = isPinned
		? pinned.filter((id) => id !== sessionId)
		: [...pinned, sessionId];
	const rest = tabs.filter((id) => id !== sessionId);
	const nextTabs = [
		...rest.filter((id) => nextPinned.includes(id)),
		...(isPinned ? [] : [sessionId]),
		...rest.filter((id) => !nextPinned.includes(id)),
		...(isPinned ? [sessionId] : []),
	];
	return { tabs: nextTabs, pinned: nextPinned };
}

/**
 * 拖拽排序：source 插入到 target 前/后。
 * - 同区内拖动：仅在对应区间内重排；
 * - 交叉拖动（固定 ↔ 普通）：自动转换 source 的固定状态（与 VS Code/浏览器一致），
 *   插入目标区间对应位置。
 */
export function reorderSessionTabs(
	tabs: readonly string[],
	pinned: readonly string[],
	sourceId: string,
	targetId: string,
	position: "before" | "after",
): { tabs: string[]; pinned: string[] } {
	if (sourceId === targetId) return { tabs: [...tabs], pinned: [...pinned] };
	const sourcePinned = pinned.includes(sourceId);
	const targetPinned = pinned.includes(targetId);
	// 交叉拖放：源进入目标区域，同步固定集合
	const nextPinned = sourcePinned === targetPinned
		? [...pinned]
		: sourcePinned
			? pinned.filter((id) => id !== sourceId)
			: [...pinned, sourceId];

	const rest = tabs.filter((id) => id !== sourceId);
	const pinnedList = rest.filter((id) => nextPinned.includes(id));
	const normalList = rest.filter((id) => !nextPinned.includes(id));
	const insert = (list: string[], ref: string, pos: "before" | "after") => {
		const index = list.indexOf(ref);
		const at = index === -1 ? list.length : index + (pos === "after" ? 1 : 0);
		return [...list.slice(0, at), sourceId, ...list.slice(at)];
	};
	const nextPinnedList = targetPinned
		? insert(pinnedList, targetId, position)
		: pinnedList;
	const nextNormalList = targetPinned
		? normalList
		: insert(normalList, targetId, position);
	return { tabs: [...nextPinnedList, ...nextNormalList], pinned: nextPinned };
}
