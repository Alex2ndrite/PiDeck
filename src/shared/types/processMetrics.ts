/**
 * 进程内存监控快照类型。
 *
 * 数据源分层：
 * - Electron 自身进程（主/渲染/GPU/utility）来自主进程 `app.getAppMetrics()`，
 *   每个进程的 workingSetSize/privateBytes 由 Chromium 直接上报（字节）。
 * - pi agent 子进程不在 app metrics 里，由主进程按 pid 调系统命令查询内存
 *   （Windows `tasklist` / Linux·macOS `ps -o rss`），缺失时为 undefined。
 */
export type ElectronProcessMetric = {
	/** 操作系统进程号 */
	pid: number;
	/** Chromium 进程类型：main / renderer / gpu / utility / zygote / sandbox_helper... */
	type: string;
	/** 常驻内存（字节）；workingSetSize，未采样到时为 undefined */
	memoryBytes?: number;
	/** 峰值常驻内存（字节） */
	peakMemoryBytes?: number;
	/** 私有字节（字节，Windows 语义） */
	privateBytes?: number;
	/** 最近一次采样的 CPU 占用百分比（0-100） */
	cpuPercent?: number;
};

export type AgentProcessMetric = {
	/** pi agent 会话标识（AgentManager 内唯一） */
	agentId: string;
	/** agent 子进程 pid */
	pid: number;
	/** 常驻内存（字节）；系统命令采样失败时 undefined */
	memoryBytes?: number;
	/** 该进程采样失败的原因（非致命，仅展示用） */
	error?: string;
};

export type ProcessMetricsSnapshot = {
	/** Electron 自身各进程 */
	electron: ElectronProcessMetric[];
	/** 正在运行的 pi agent 子进程 */
	agents: AgentProcessMetric[];
	/** Electron 各进程内存之和（字节）；口径 = 专用工作集优先（privateBytes>0 时），
	 *  Browser 进程 privateBytes 为 0 回退 workingSetSize。
	 *  专用口径避免共享页在多进程合计时重复计数（比任务管理器"内存"列大 1.5-2 倍的老问题）。 */
	totalElectronBytes: number;
	/** pi agents 已采样内存之和（字节，失败项不计；Windows 为专用内存，其余平台 RSS） */
	totalAgentBytes: number;
	/** 快照采样时间戳（ms） */
	sampledAt: number;
};
