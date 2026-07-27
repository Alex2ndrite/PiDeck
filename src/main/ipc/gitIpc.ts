import { ipcMain } from "electron";
import { resolve } from "node:path";
import { ipcChannels } from "../../shared/ipc";
import type { GitWorkspaceDiffGroup } from "../../shared/types";
import type { GitService } from "../git/GitService";
import type { AppLogger } from "../logging/AppLogger";
import type { PiLocator } from "../pi/PiLocator";
import type { ProjectStore } from "../projects/ProjectStore";
import type { SettingsStore } from "../settings/SettingsStore";
import type { WorktreeService } from "../git/WorktreeService";

export type GitIpcDeps = {
	appLogger: Pick<AppLogger, "warn">;
	gitService: GitService;
	piLocator: PiLocator;
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	worktreeService: WorktreeService;
};

export function registerGitIpc({
	appLogger,
	gitService,
	piLocator,
	projectStore,
	settingsStore,
	worktreeService,
}: GitIpcDeps): void {
	ipcMain.handle(ipcChannels.gitBranches, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		return gitService.getBranches(project.path);
	});

	ipcMain.handle(
		ipcChannels.gitCheckout,
		async (_event, projectId: string, branch: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return gitService.checkout(project.path, branch);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCreateBranch,
		async (_event, projectId: string, branchName: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return gitService.createBranch(project.path, branchName);
		},
	);

	// 差异查看需要文件的 Git HEAD 原始内容作为对比基准；参数是绝对文件路径，后端自行定位仓库根。
	ipcMain.handle(
		ipcChannels.gitOriginalContent,
		async (_event, filePath: string) => {
			const maxBytes = Math.max(1, settingsStore.get().maxEditorFileSizeMB) * 1024 * 1024;
			return gitService.getOriginalContent(filePath, maxBytes);
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeList,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const entries = await worktreeService.list(project.path);
			// 每次扫描都同步注册外部新增 worktree，保证侧栏数据和 git 状态一致。
			for (const wt of entries) {
				await projectStore.add(wt.path, projectId);
			}
			return entries;
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeCreate,
		async (_event, projectId: string, branchName: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const info = await worktreeService.create(project.path, projectId, branchName);
			await projectStore.add(info.path, projectId);
			return info;
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorktreeRemove,
		async (_event, projectId: string, worktreePath: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const ok = await worktreeService.remove(worktreePath, project.path);
			const normalizeForCompare = (value: string) => {
				const resolved = resolve(value);
				return process.platform === "win32" ? resolved.toLowerCase() : resolved;
			};
			const normalizedTarget = normalizeForCompare(worktreePath);
			const stillInGit = (await worktreeService.list(project.path)).some(
				(entry) => normalizeForCompare(entry.path) === normalizedTarget,
			);
			// 如果 git 已经没有该 worktree（包括用户在外部删过导致 remove 返回 false），
			// 也要清理 PiDeck 项目记录，否则重启后会从 projects.json 恢复成“删不掉”。
			if (ok || !stillInGit) {
				const child = projectStore.findByPath(worktreePath);
				if (child) await projectStore.remove(child.id);
				return true;
			}
			return false;
		},
	);

	// -- Git 增强：提交历史 / 分支对比 / Graph
	ipcMain.handle(
		ipcChannels.gitCommitLog,
		async (_event, projectId: string, options?: { maxEntries?: number; ref?: string; path?: string; allBranches?: boolean }) => {
			const project = projectStore.get(projectId);
			if (!project) return [];
			return gitService.getCommitLog(project.path, options);
		},
	);

	ipcMain.handle(
		ipcChannels.gitRefs,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) return [];
			return gitService.getRefs(project.path);
		},
	);

	ipcMain.handle(
		ipcChannels.gitBranchCompare,
		async (_event, projectId: string, base: string, target: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return gitService.compareBranches(project.path, base, target);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCommitDetail,
		async (_event, projectId: string, ref: string) => {
			const project = projectStore.get(projectId);
			if (!project) return null;
			return gitService.getCommitDetail(project.path, ref);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCommitFileDiff,
		async (_event, projectId: string, ref: string, filePath: string, originalPath?: string) => {
			const project = projectStore.get(projectId);
			if (!project) return null;
			const maxBytes = Math.max(1, settingsStore.get().maxEditorFileSizeMB) * 1024 * 1024;
			return gitService.getCommitFileDiff(project.path, ref, filePath, originalPath, maxBytes);
		},
	);

	ipcMain.handle(
		ipcChannels.gitDiffFileBetween,
		async (_event, projectId: string, ref1: string, ref2: string, filePath: string) => {
			const project = projectStore.get(projectId);
			if (!project) return "";
			return gitService.diffFileBetweenRefs(project.path, ref1, ref2, filePath);
		},
	);


	// Git 工作区状态 + Stage/Unstage
	ipcMain.handle(
		ipcChannels.gitStatus,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) return { merge: [], index: [], workingTree: [], untracked: [] };
			return gitService.getStatus(project.path);
		},
	);

	ipcMain.handle(
		ipcChannels.gitWorkspaceFileDiff,
		async (_event, projectId: string, group: GitWorkspaceDiffGroup, filePath: string) => {
			const project = projectStore.get(projectId);
			if (!project) return null;
			const maxBytes = Math.max(1, settingsStore.get().maxEditorFileSizeMB) * 1024 * 1024;
			return gitService.getWorkspaceFileDiff(project.path, group, filePath, maxBytes);
		},
	);

	ipcMain.handle(
		ipcChannels.gitStage,
		async (_event, projectId: string, paths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.stageFiles(project.path, paths);
		},
	);

	ipcMain.handle(
		ipcChannels.gitUnstage,
		async (_event, projectId: string, paths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.unstageFiles(project.path, paths);
		},
	);

	ipcMain.handle(
		ipcChannels.gitDiscard,
		async (_event, projectId: string, group: "workingTree" | "untracked", filePath: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.discardFile(project.path, group, filePath);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCommit,
		async (_event, projectId: string, message: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.commit(project.path, message);
		},
	);

	ipcMain.handle(
		ipcChannels.gitCherryPick,
		async (_event, projectId: string, hash: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.cherryPick(project.path, hash);
		},
	);

	ipcMain.handle(
		ipcChannels.gitRevert,
		async (_event, projectId: string, hash: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.revertCommit(project.path, hash);
		},
	);

	ipcMain.handle(
		ipcChannels.gitPush,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.push(project.path);
		},
	);

	ipcMain.handle(
		ipcChannels.gitPull,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.pull(project.path);
		},
	);

	ipcMain.handle(
		ipcChannels.gitReset,
		async (_event, projectId: string, hash: string, mode: "soft" | "mixed" | "hard") => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.resetToCommit(project.path, hash, mode);
		},
	);

	ipcMain.handle(
		ipcChannels.gitDropCommit,
		async (_event, projectId: string, hash: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			await gitService.dropCommit(project.path, hash);
		},
	);

	ipcMain.handle(
		ipcChannels.gitGenerateCommitMessage,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) return "";
			const diff = await gitService.getStagedDiff(project.path);
			if (!diff.trim()) return "";

			// 构建提示词：因在模板字面量中避免嵌套反引号，使用数组拼接
			const prompt = [
				"请根据以下 git diff 生成一条中文 git commit message。",
				"格式：feat: / fix: / refactor: / chore: / docs: / style: / perf: / test: 等标准约定式提交前缀。",
				"只输出 message 本身，不要解释，不要包含 markdown 标记。",
				"",
				diff.slice(0, 8000),
			].join("\n");

			const settings = settingsStore.get();
			const command = piLocator.resolveCommand(
				settings.customPiPath,
				settings.wslEnabled,
				settings.wslDistro,
				settings.wslUser,
			);
			const invocation = piLocator.createInvocation(command, [
				"-p", prompt,
			]);
			const { execFile } = await import("node:child_process");
			const result = await new Promise<string>((resolve, reject) => {
				execFile(invocation.command, invocation.args, {
					env: piLocator.createProcessEnv(settings, invocation.pathPrefix, invocation.wsl),
					shell: invocation.shell,
					windowsHide: true,
					timeout: 30_000,
					encoding: "utf8",
					windowsVerbatimArguments: invocation.windowsVerbatimArguments,
				}, (error, stdout, stderr) => {
					if (error) {
						const message = (stderr || error.message).slice(0, 500);
						void appLogger.warn("git", "Generate commit message failed", { error: message });
						reject(new Error(message));
						return;
					}
					resolve(stdout.trim());
				});
			});
			return result;
		},
	);

	ipcMain.handle(
		ipcChannels.gitInit,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			const { execFile } = await import("node:child_process");
			await execFile("git", ["init"], { cwd: project.path });
		},
	);

}
