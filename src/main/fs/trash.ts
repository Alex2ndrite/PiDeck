/**
 * 将文件/目录移入系统回收站（可恢复删除）。
 *
 * 统一入口：所有「用户主动删除」都必须走这里，禁止直接 rm/unlink 硬删
 * （历史教训：worktree 误删曾导致整目录永久丢失）。
 * 回收站不可用/被禁用时直接抛错——删除失败比永久丢失安全，
 * 调用方（IPC handler / 服务层）负责把错误呈现给用户。
 *
 * electron 采用懒加载：GitService 等模块会被纯 Node 集成测试真实编译执行，
 * 顶层 import "electron" 会直接 MODULE_NOT_FOUND；延迟到调用时才 require，
 * 只有真正执行删除路径才需要 electron 环境。
 */
let shellRef: typeof import("electron").shell | undefined;

async function getShell(): Promise<typeof import("electron").shell> {
	if (!shellRef) {
		shellRef = (await import("electron")).shell;
	}
	return shellRef;
}

export async function trashPath(targetPath: string): Promise<void> {
	const shell = await getShell();
	await shell.trashItem(targetPath);
}
