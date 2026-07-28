import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { ipcChannels } from "../../shared/ipc";
import type { FileSystemService } from "../fs/FileSystemService";
import type { ProjectStore } from "../projects/ProjectStore";
import type { SettingsStore } from "../settings/SettingsStore";
import type { AppLogger } from "../logging/AppLogger";

export type FilesIpcDeps = {
	fileSystemService: FileSystemService;
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	appLogger: Pick<AppLogger, "info">;
	getMainWindow: () => BrowserWindow | null;
};

export function registerFilesIpc({
	fileSystemService,
	projectStore,
	settingsStore,
	appLogger,
	getMainWindow,
}: FilesIpcDeps): void {
	// 将 WSL Linux 路径转为 Windows 可访问的路径（/mnt/c → C:\，/home/... → \\wsl$\<distro>\...）
	const toWindowsPath = (linuxPath: string): string => {
		if (!linuxPath || /^[A-Za-z]:/.test(linuxPath)) return linuxPath; // 已是 Windows 路径
		// /mnt/c/Users/... → C:\Users\...
		const mntMatch = linuxPath.match(/^\/mnt\/([a-z])\/(.*)/);
		if (mntMatch) {
			return `${mntMatch[1].toUpperCase()}:\\${mntMatch[2].replace(/\//g, "\\")}`;
		}
		// /home/user/... → \\wsl$\<distro>\home\user\...
		const settings = settingsStore.get();
		if (settings.wslEnabled && settings.wslDistro) {
			return `\\\\wsl$\\${settings.wslDistro}\\${linuxPath.replace(/^\//, "").replace(/\//g, "\\")}`;
		}
		return linuxPath;
	};

	ipcMain.handle(ipcChannels.dialogPickFiles, async (_event, options?: { title?: string }) => {
		const result = await dialog.showOpenDialog({
			// 调用方传入经过 i18n 的标题；缺省时交由系统使用平台默认文案。
			title: options?.title,
			properties: ["openFile", "openDirectory", "multiSelections"],
		});
		return result.canceled ? [] : result.filePaths;
	});

	ipcMain.handle(ipcChannels.filesList, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		return fileSystemService.listTree(project.path);
	});

	ipcMain.handle(ipcChannels.filesOpen, async (_event, path: string) => {
		const error = await shell.openPath(toWindowsPath(path));
		// Electron 通过返回字符串报告打开失败；显式抛出后前端才能提示路径不存在或系统无法打开。
		if (error) throw new Error(error);
	});

	ipcMain.handle(ipcChannels.browserOpenExternal, async (_event, url: string) => {
		// This IPC is renderer-callable, so it must share the protocol gate used by
		// every other external-link path instead of passing arbitrary schemes to the OS.
		if (!url.startsWith("http:") && !url.startsWith("https:")) return;
		await shell.openExternal(url);
	});

	ipcMain.handle(ipcChannels.filesReadContent, async (_event, path: string) => {
		try {
			return await readFile(toWindowsPath(path), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return "";
			}
			throw error;
		}
	});

	ipcMain.handle(ipcChannels.filesWriteContent, async (_event, path: string, content: string) => {
		await writeFile(path, content, "utf8");
		void appLogger.info("file", "File written", { path, bytes: Buffer.byteLength(content, "utf8") });
	});

	ipcMain.handle(
		ipcChannels.filesCreate,
		async (_event, parentDir: string, name: string, type: "file" | "directory") => {
			const result = await fileSystemService.create(parentDir, name, type);
			void appLogger.info("file", "File/folder created", { parentDir, name, type, result });
			return result;
		},
	);

	ipcMain.handle(ipcChannels.filesDelete, async (_event, path: string, recursive?: boolean) => {
		await fileSystemService.delete(path, recursive);
		void appLogger.info("file", "File deleted", { path, recursive: Boolean(recursive) });
	});

	ipcMain.handle(ipcChannels.filesRename, async (_event, path: string, newName: string) => {
		const result = await fileSystemService.rename(path, newName);
		void appLogger.info("file", "File renamed", { path, newName, result });
		return result;
	});

	ipcMain.handle(
		ipcChannels.filesShowInFolder,
		async (_event, path: string) => {
			shell.showItemInFolder(toWindowsPath(path));
		},
	);
}
