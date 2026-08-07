import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSmoothStream - 流式文本平滑渲染 Hook（逐字打字机）。
 *
 * 将高频推送的完整文本转化为平滑的逐字渲染效果（参考 Cherry Studio / Proma 实现）：
 *
 * 核心机制：
 * 1. 内容变化时用 startsWith 判断追加，增量经 Intl.Segmenter 拆为字符粒度入队
 *    （Intl.Segmenter 正确处理中文/日文/韩文等多字节字符）；
 * 2. requestAnimationFrame 驱动渲染循环；
 * 3. 每帧动态计算渲染字符数：队列长时快速追赶（/divisor），短时慢速浮现；
 * 4. 流结束后加速但渐进排空队列（不一次性 dump，避免跳动）。
 *
 * 设计说明：
 * - 只影响"展示"；权威文本在 atom/父组件中不受影响（复制/导出仍拿全文）。
 * - 纯 hook，不依赖任何 UI 库；与 timeline/turn 领域模型解耦。
 *
 * 性能注意（Pideck 特有）：streamdown 每次解析的是完整文本，逐字渐显会把解析频率
 * 提到 rAF 级别；若界面卡顿，调大 minDelay（如 24/33ms）或降低 divisor。
 */

interface UseSmoothStreamOptions {
	/** 原始流式内容（每次 chunk 累积后的完整文本） */
	content: string;
	/** 是否正在流式输出中 */
	isStreaming: boolean;
	/** 每帧最小间隔（ms）。Pideck streamdown 解析较重，默认 16ms（~60fps），可上调 */
	minDelay?: number;
	/** 渲染速率除数：队列剩余 / divisor = 本帧渲染字符数（流式中） */
	streamingDivisor?: number;
	/** 流结束后的排空除数（加速但渐进，不 dump） */
	drainDivisor?: number;
}

interface UseSmoothStreamReturn {
	/** 平滑后的显示内容 */
	displayedContent: string;
}

/** 多语言字符分割器（正确处理中文、日文等多字节字符） */
const segmenter = new Intl.Segmenter([
	"en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "de-DE", "fr-FR", "es-ES", "pt-PT", "ru-RU",
]);

function segmentText(text: string): string[] {
	return Array.from(segmenter.segment(text)).map((s) => s.segment);
}

export function useSmoothStream({
	content,
	isStreaming,
	minDelay = 16,
	streamingDivisor = 8,
	drainDivisor = 4,
}: UseSmoothStreamOptions): UseSmoothStreamReturn {
	const [displayedContent, setDisplayedContent] = useState(content);

	// 待渲染的字符队列
	const chunkQueueRef = useRef<string[]>([]);
	// rAF ID
	const rafRef = useRef<number | null>(null);
	// 已渲染到 UI 的文本
	const displayedRef = useRef(content);
	// 上一次收到的完整内容（用于计算 delta）
	const prevContentRef = useRef(content);
	// 上次渲染时间
	const lastRenderTimeRef = useRef(0);
	// 流是否结束
	const streamDoneRef = useRef(!isStreaming);
	streamDoneRef.current = !isStreaming;

	// 内容变化：计算 delta 并入队
	useEffect(() => {
		const prevContent = prevContentRef.current;
		const newContent = content;
		if (newContent === prevContent) return;

		const isAppend = newContent.startsWith(prevContent);
		if (isAppend) {
			// 正常流式追加：增量拆字符入队
			const delta = newContent.slice(prevContent.length);
			if (delta) {
				const chars = segmentText(delta);
				chunkQueueRef.current.push(...chars);
			}
		} else {
			// 内容重置（切换消息/编辑等场景）：清空队列直接同步
			chunkQueueRef.current = [];
			displayedRef.current = newContent;
			setDisplayedContent(newContent);
		}
		prevContentRef.current = newContent;
	}, [content]);

	// 非流式状态安全网：确保最终内容一致，但不立即 dump 队列（让 rAF 自然排空）
	useEffect(() => {
		if (isStreaming) return;
		if (rafRef.current) return; // rAF 仍在运行：让队列自然排空
		if (chunkQueueRef.current.length > 0) {
			displayedRef.current += chunkQueueRef.current.join("");
			chunkQueueRef.current = [];
		}
		if (displayedRef.current !== content) {
			displayedRef.current = content;
		}
		setDisplayedContent(displayedRef.current);
	}, [isStreaming, content]);

	// 渲染循环
	const renderLoop = useCallback(
		(currentTime: number) => {
			const queue = chunkQueueRef.current;
			if (queue.length === 0) {
				if (streamDoneRef.current) {
					// 流结束 + 队列空：同步最终内容并停止
					if (displayedRef.current !== prevContentRef.current) {
						displayedRef.current = prevContentRef.current;
						setDisplayedContent(displayedRef.current);
					}
					rafRef.current = null;
					return;
				}
				// 流未结束但队列空：等下一帧
				rafRef.current = requestAnimationFrame(renderLoop);
				return;
			}

			if (currentTime - lastRenderTimeRef.current < minDelay) {
				rafRef.current = requestAnimationFrame(renderLoop);
				return;
			}
			lastRenderTimeRef.current = currentTime;

			// 动态计算本帧渲染字符数：流中 /streamingDivisor 保持深缓冲（丝滑），
			// 结束后 /drainDivisor 加速排空
			const divisor = streamDoneRef.current ? drainDivisor : streamingDivisor;
			const count = Math.max(1, Math.floor(queue.length / divisor));
			const chars = queue.splice(0, count);
			displayedRef.current += chars.join("");
			setDisplayedContent(displayedRef.current);

			if (queue.length > 0 || !streamDoneRef.current) {
				rafRef.current = requestAnimationFrame(renderLoop);
			} else {
				// 队列刚排空 + 流已结束：同步最终内容并停止
				if (displayedRef.current !== prevContentRef.current) {
					displayedRef.current = prevContentRef.current;
					setDisplayedContent(displayedRef.current);
				}
				rafRef.current = null;
			}
		},
		[minDelay, streamingDivisor, drainDivisor],
	);

	// 启动/重启渲染循环（流结束后也继续运行直到队列排空）
	useEffect(() => {
		if ((isStreaming || chunkQueueRef.current.length > 0) && !rafRef.current) {
			rafRef.current = requestAnimationFrame(renderLoop);
		}
		return () => {
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [isStreaming, renderLoop]);

	return { displayedContent };
}
