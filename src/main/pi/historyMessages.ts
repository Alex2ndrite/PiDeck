import type { ChatMessage } from "../../shared/types";

/**
 * 消息内容指纹：跨「运行期事件身份（randomUUID）」与「文件投影身份
 * （agentId-history-entryId）」匹配同一 pi 消息的唯一可靠手段——
 * 两条通道的 ChatMessage.id 永不相同（事件消息无 pi id 可用），
 * 但同一条 pi 消息的正文内容一致。
 *
 * 指纹组成（按角色区分）：
 * - tool：meta.toolCallId（两通道同源，pi 的 toolCallId；text 不可靠——
 *   运行期带 ▶/✓ 前缀、投影带 ✓/✗ 前缀，且随执行状态变化）；
 * - user/assistant/system/error：role + text + thinking + 图片签名
 *   （图片签名 = mimeType + data 长度 + 首尾采样，避免大 base64 全量参与比较）。
 */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function imageSignature(message: ChatMessage): string {
	const images = message.images ?? [];
	if (images.length === 0) return "";
	return images
		.map((image) => {
			const data = image.data ?? "";
			const head = data.slice(0, 64);
			const tail = data.length > 128 ? data.slice(-64) : "";
			return `${image.mimeType}:${data.length}:${head}${tail}`;
		})
		.join(",");
}

export function messageFingerprint(message: ChatMessage): string {
	const role = message.role;
	const toolCallId =
		message.role === "tool"
			? (message.meta as Record<string, unknown> | undefined)?.toolCallId
			: undefined;
	if (typeof toolCallId === "string" && toolCallId) {
		return `tool\u0000${toolCallId}`;
	}
	return [
		role,
		stripAnsi(message.text),
		stripAnsi(message.thinking ?? ""),
		imageSignature(message),
	].join("\u0000");
}

/**
 * 后台加载历史消息完成后，把加载期间新增的实时消息接回历史尾部。
 * 大会话 get_messages 可能很慢；用户在等待期间发送的消息不能被历史结果覆盖。
 *
 * 去重语义（修复双份回归）：投影结果（get_messages 快照）与运行期缓存
 * （事件流/乐观写入）可能包含「同一条 pi 消息的两个副本」——快照晚于消息
 * 落盘时投影含完整版（带 entryId），运行期缓存里还有事件版（randomUUID）。
 * 旧实现只按 ChatMessage.id 去重（两通道 id 永不相同）→ 双份进入渲染层，
 * 被用户消息切分到上下两个 run（「中间回复在上一轮/下一轮都显现」）。
 *
 * 现在按「内容指纹」一一消耗匹配：preserved（加载期间新增）消息与投影消息
 * 指纹相同 → 视为同一条，丢弃运行期副本（以投影为准：位置正确、带 entryId）；
 * 指纹不匹配 → 真正未落盘的进行中消息，保留在尾部等待事件流继续 upsert。
 */
export function mergeHistoryWithPreservedMessages(
	historyMessages: ChatMessage[],
	currentMessages: ChatMessage[],
	preserveMessagesAfter?: number,
): ChatMessage[] {
	if (!preserveMessagesAfter) return historyMessages;
	// 投影侧指纹预索引（fingerprint → 未消耗下标队列）：大会话投影几千条时避免
	// 对每条 preserved 做全表扫描（O(p×n) → O(p + n)），后台加载完成不卡主线程。
	const fingerprintToHistoryIndices = new Map<string, number[]>();
	historyMessages.forEach((historyMessage, index) => {
		const fingerprint = messageFingerprint(historyMessage);
		const indices = fingerprintToHistoryIndices.get(fingerprint);
		if (indices) indices.push(index);
		else fingerprintToHistoryIndices.set(fingerprint, [index]);
	});
	const consumedHistory = new Set<number>();
	const preservedMessages = currentMessages.filter((message) => {
		if (
			message.timestamp < preserveMessagesAfter ||
			message.meta?.historyLoading === true
		) {
			return false;
		}
		const fingerprint = messageFingerprint(message);
		const candidates = fingerprintToHistoryIndices.get(fingerprint);
		if (!candidates) return true;
		// 一一消耗：连发多条相同文本时逐一对应，避免错配删多。
		const historyIndex = candidates.find((index) => !consumedHistory.has(index));
		if (historyIndex === undefined) return true;
		// 投影里已有同一条 pi 消息：运行期副本是双份，丢弃（投影为准）。
		consumedHistory.add(historyIndex);
		return false;
	});
	return preservedMessages.length > 0
		? [...historyMessages, ...preservedMessages]
		: historyMessages;
}
