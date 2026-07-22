import { useEffect, useRef, useState } from "react";
import { subscribeToNotice } from "../../utils/notice";

export type NoticeData = {
	message: string;
	duration: number;
	kind?: "info" | "error" | "warning";
};

export type NoticeCenterProps = {
	subscribe?: (listener: (data: NoticeData | null) => void) => () => void;
};

/** Renders the one-shot notice stream and always clears its timer on replacement/unmount. */
export function NoticeCenter({ subscribe = subscribeToNotice }: NoticeCenterProps) {
	const [notice, setNotice] = useState<NoticeData | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		const unsubscribe = subscribe((next) => {
			if (timer.current) clearTimeout(timer.current);
			if (!next) {
				setNotice(null);
				return;
			}
			setNotice(next);
			timer.current = setTimeout(() => {
				setNotice(null);
				timer.current = null;
			}, Math.max(0, next.duration));
		});
		return () => {
			unsubscribe();
			if (timer.current) clearTimeout(timer.current);
			timer.current = null;
		};
	}, [subscribe]);
	if (!notice) return null;
	return <div className={`app-notice${notice.kind ? ` ${notice.kind}` : ""}`} role="status">{notice.message}</div>;
}
