import React from "react";
import ReactDOM from "react-dom/client";
import { useState, useEffect } from "react";
import type { PetAggregateState, PetManifest, PetNotification, PetWindowCaps } from "@shared/types";
import { PetOverlay } from "./PetOverlay";
import { PetInteraction } from "./PetInteraction";
import type { PetDragMode } from "./PetDragDirection";
import { loadSpriteSheet, type SpriteSheet } from "./PetSpriteSheet";
import "./pet.css";

function PetApp() {
	const [state, setState] = useState<PetAggregateState>({ mode: "idle", runningCount: 0, errorCount: 0, activeAgentId: null, timestamp: 0 });
	const [sprite, setSprite] = useState<SpriteSheet | null>(null);
	const [ready, setReady] = useState(false);
	const [dragMode, setDragMode] = useState<PetDragMode | null>(null);
	const [notif, setNotif] = useState<PetNotification | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [caps, setCaps] = useState<PetWindowCaps | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = async (m: PetManifest | null) => {
			if (!m || cancelled) return;
			try { setSprite(await loadSpriteSheet(m)); } catch { setSprite(null); }
			setReady(true);
		};
		void window.piDesktop.pet.getCurrent().then(load);
		const cleanups = [
			window.piDesktop.pet.onSprite(load),
			window.piDesktop.pet.onState(setState),
			window.piDesktop.pet.onNotify((n) => { setNotif({ ...n, timestamp: performance.now() }); setTimeout(() => setNotif(null), 4000); }),
			window.piDesktop.pet.onPreviewMode((m: string) => setPreview(m || null)),
			window.piDesktop.pet.onCaps(setCaps),
		];
		// 通知主进程：所有 IPC 监听器已注册，可安全推送初始状态（避免时序竞态）
		window.piDesktop.pet.ready();
		return () => { cancelled = true; cleanups.forEach(fn => fn?.()); };
	}, []);

	if (!ready) return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;

	// 拖拽方向是本地瞬时显示态；松手后立即恢复最新业务态。preview 仅用于设置页预览。
	const displayMode: PetAggregateState["mode"] = dragMode
		?? (preview ? (preview as PetAggregateState["mode"]) : state.mode);
	const displayState: PetAggregateState = { ...state, mode: displayMode };

	return (
		<div className={`pet-root${caps && !caps.transparent ? " pet-root--rounded" : ""}`}>
			<PetOverlay sprite={sprite} manifest={null} state={displayState} notification={notif} />
			<PetInteraction state={state} onDragModeChange={setDragMode} canMove={caps?.freePosition !== false} />
		</div>
	);
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><PetApp /></React.StrictMode>);
