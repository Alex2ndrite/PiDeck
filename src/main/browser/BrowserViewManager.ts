import { WebContentsView, type BrowserWindow, type Rectangle } from "electron";
import { BROWSER_PANEL_PARTITION, isAllowedBrowserPanelUrl } from "./browserSecurity";

/**
 * WebContentsView 版内置浏览器管理器（UI 2.0 / issue #115 U4 灰度）。
 *
 * 与 <webview> 管线的根本差异：WebContents 由主进程持有并叠加在窗口上，
 * 渲染层只上报占位矩形（bounds），不再有 guest 注入面。安全策略（partition、
 * 导航白名单、新窗口拦截）全部在主进程一处注册，渲染层零信任代码。
 *
 * 设计要点：
 * - 单例单视图：与 BrowserPanel「单 webview 切 tab 即 loadURL」的现有模型一致；
 * - 新窗口请求不就地打开：deny 后广播事件，由渲染层决定面板新 tab 或系统浏览器；
 * - 视图随窗口销毁，无需单独生命周期；hide 只是移出视图树，WebContents 保留
 *   （页面状态/滚动位置在折叠抽屉后不丢失）。
 */

export type BrowserViewState = {
	url: string;
	title: string;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
};

type Logger = { warn: (scope: string, message: string, detail?: unknown) => Promise<void> | void };

export class BrowserViewManager {
	private view: WebContentsView | null = null;

	constructor(
		private readonly getWindow: () => BrowserWindow | null,
		private readonly logger: Logger,
		private readonly onNewWindowRequest: (url: string) => void,
	) {}

	/** 创建（幂等）并挂载视图；bounds 为相对窗口内容区的 DIP 坐标。 */
	show(bounds: Rectangle, url?: string): void {
		const view = this.ensureView();
		const win = this.getWindow();
		if (!win || win.isDestroyed()) return;
		if (!win.contentView.children.includes(view)) {
			win.contentView.addChildView(view);
		}
		view.setBounds(this.sanitizeBounds(bounds));
		view.setVisible(true);
		if (url && isAllowedBrowserPanelUrl(url) && view.webContents.getURL() !== url) {
			void view.webContents.loadURL(url).catch(() => undefined);
		}
		this.emitState();
	}

	hide(): void {
		const win = this.getWindow();
		if (!win || win.isDestroyed() || !this.view) return;
		// setVisible(false) 即可停止绘制与命中；不移出视图树，避免重挂载抖动
		this.view.setVisible(false);
	}

	setBounds(bounds: Rectangle): void {
		this.view?.setBounds(this.sanitizeBounds(bounds));
	}

	navigate(url: string, userAgent?: string | null): boolean {
		if (!isAllowedBrowserPanelUrl(url)) {
			void this.logger.warn("browser", "Blocked browser view navigate to disallowed url", { url });
			return false;
		}
		const view = this.ensureView();
		if (userAgent !== undefined && userAgent !== null) {
			view.webContents.setUserAgent(userAgent);
		}
		void view.webContents.loadURL(url).catch(() => undefined);
		return true;
	}

	goBack(): void { this.view?.webContents.navigationHistory.goBack(); }
	goForward(): void { this.view?.webContents.navigationHistory.goForward(); }
	reload(): void { this.view?.webContents.reload(); }

	setUserAgent(userAgent: string | null): void {
		if (!this.view) return;
		if (userAgent) this.view.webContents.setUserAgent(userAgent);
	}

	getState(): BrowserViewState | null {
		if (!this.view) return null;
		const wc = this.view.webContents;
		return {
			url: wc.getURL(),
			title: wc.getTitle(),
			isLoading: wc.isLoading(),
			canGoBack: wc.navigationHistory.canGoBack(),
			canGoForward: wc.navigationHistory.canGoForward(),
		};
	}

	private sanitizeBounds(bounds: Rectangle): Rectangle {
		// 渲染层坐标不可信：非法值直接归零，负尺寸钳制为 0，防止视图飞出窗口
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
		return { x: num(bounds?.x), y: num(bounds?.y), width: num(bounds?.width), height: num(bounds?.height) };
	}

	private ensureView(): WebContentsView {
		if (this.view) return this.view;
		const view = new WebContentsView({
			webPreferences: {
				partition: BROWSER_PANEL_PARTITION,
				sandbox: true,
				nodeIntegration: false,
				contextIsolation: true,
				webSecurity: true,
				allowRunningInsecureContent: false,
				webviewTag: false,
			},
		});
		const wc = view.webContents;
		// 与 webview 管线同一白名单：frame 导航与重定向两层都拦
		const blockUnsafe = (event: { url: string; preventDefault(): void }, phase: string) => {
			if (isAllowedBrowserPanelUrl(event.url)) return;
			event.preventDefault();
			void this.logger.warn("browser", "Blocked unsafe browser view navigation", { phase, url: event.url });
		};
		wc.on("will-frame-navigate", (event) => blockUnsafe(event, "navigate"));
		wc.on("will-redirect", (event) => blockUnsafe(event, "redirect"));
		// 新窗口一律 deny：http(s) 交给渲染层开面板新 tab，其余协议走系统浏览器
		wc.setWindowOpenHandler(({ url }) => {
			this.onNewWindowRequest(url);
			return { action: "deny" };
		});
		const emit = () => this.emitState();
		wc.on("did-navigate", emit);
		wc.on("did-navigate-in-page", emit);
		wc.on("did-start-loading", emit);
		wc.on("did-stop-loading", emit);
		wc.on("page-title-updated", emit);
		this.view = view;
		return view;
	}

	private emitState(): void {
		const win = this.getWindow();
		const state = this.getState();
		if (!win || win.isDestroyed() || !state) return;
		win.webContents.send("browserView:state", state);
	}
}
