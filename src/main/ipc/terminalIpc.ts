import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { SessionCommandError, SessionRuntimeTarget } from "../../shared/types";
import type { AppLogger } from "../logging/AppLogger";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import type { TerminalSessionManager } from "../terminal/TerminalSessionManager";

export type TerminalIpcDeps = {
	appLogger: Pick<AppLogger, "info">;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;
	terminalManager: TerminalSessionManager;
	toSessionCommandIpcError: (error: SessionCommandError) => Error;
};

export function registerTerminalIpc({
	appLogger,
	sessionRuntimeCoordinator,
	terminalManager,
	toSessionCommandIpcError,
}: TerminalIpcDeps): void {
	const requireRuntimeTarget = (target: SessionRuntimeTarget) => {
		const validated = sessionRuntimeCoordinator.validateTarget(target);
		if (!validated.ok) throw toSessionCommandIpcError(validated.error);
		return validated;
	};

	ipcMain.handle(ipcChannels.terminalList, (_event, target: SessionRuntimeTarget) => {
		requireRuntimeTarget(target);
		return terminalManager.list(target.agentId);
	});
	ipcMain.handle(ipcChannels.terminalEnsure, (_event, target: SessionRuntimeTarget) => {
		requireRuntimeTarget(target);
		return terminalManager.ensure(target.agentId);
	});
	ipcMain.handle(ipcChannels.terminalCreate, async (_event, target: SessionRuntimeTarget) => {
		requireRuntimeTarget(target);
		const result = await terminalManager.create(target.agentId);
		void appLogger.info("terminal", "Terminal created", {
			sessionId: target.sessionId,
			agentId: target.agentId,
			tabId: result.id,
		});
		return result;
	});
	ipcMain.handle(
		ipcChannels.terminalInput,
		(_event, tabId: string, data: string) => {
			terminalManager.input(tabId, data);
		},
	);
	ipcMain.handle(
		ipcChannels.terminalResize,
		(_event, tabId: string, cols: number, rows: number) => {
			terminalManager.resize(tabId, cols, rows);
		},
	);
	ipcMain.handle(ipcChannels.terminalClose, (_event, tabId: string) => {
		terminalManager.close(tabId);
		void appLogger.info("terminal", "Terminal closed", { tabId });
	});
}
