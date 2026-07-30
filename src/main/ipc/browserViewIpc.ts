import { ipcMain, type BrowserWindow, type Rectangle } from "electron";
import { ipcChannels } from "../../shared/ipc";
import { BrowserViewManager } from "../browser/BrowserViewManager";
import { isAllowedBrowserPanelUrl } from "../browser/browserSecurity";

/**
 * WebContentsView 浏览器 IPC 域（#115 U4）：渲染层只发「显示/隐藏/移动/导航/动作」
 * 意图，所有安全校验在主进程边界完成。入参一律不可信，先校验再转发。
 */
export function registerBrowserViewIpc(deps: {
	getMainWindow: () => BrowserWindow | null;
	appLogger: { warn: (scope: string, message: string, detail?: unknown) => Promise<void> | void };
}): BrowserViewManager {
	const manager = new BrowserViewManager(
		deps.getMainWindow,
		deps.appLogger,
		(url) => {
			// 新窗口请求转给渲染层：http(s) 在面板开新 tab，其余协议由渲染层走系统浏览器
			const win = deps.getMainWindow();
			if (!win || win.isDestroyed()) return;
			if (!isAllowedBrowserPanelUrl(url) && url !== "about:blank") {
				void deps.appLogger.warn("browser", "Blocked browser view window open", { url });
			}
			win.webContents.send(ipcChannels.browserViewNewWindow, url);
		},
	);

	ipcMain.handle(ipcChannels.browserViewShow, (_event, bounds: Rectangle, url?: string) => {
		manager.show(bounds, typeof url === "string" ? url : undefined);
	});
	ipcMain.handle(ipcChannels.browserViewHide, () => {
		manager.hide();
	});
	ipcMain.handle(ipcChannels.browserViewSetBounds, (_event, bounds: Rectangle) => {
		manager.setBounds(bounds);
	});
	ipcMain.handle(ipcChannels.browserViewNavigate, (_event, url: string, userAgent?: string | null) => {
		if (typeof url !== "string") return false;
		return manager.navigate(url, typeof userAgent === "string" ? userAgent : null);
	});
	ipcMain.handle(ipcChannels.browserViewAction, (_event, action: string) => {
		// 动作枚举白名单，防渲染层注入任意调用
		switch (action) {
			case "back": manager.goBack(); break;
			case "forward": manager.goForward(); break;
			case "reload": manager.reload(); break;
			default:
				void deps.appLogger.warn("browser", "Ignored unknown browser view action", { action });
		}
	});
	return manager;
}
