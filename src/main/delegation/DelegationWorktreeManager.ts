import { randomUUID } from "node:crypto";
import type { Project } from "../../shared/types";

type WorktreeCreator = {
	create(projectPath: string, projectId: string, branchName: string): Promise<{ path: string; branch: string }>;
	remove(worktreePath: string, projectPath: string): Promise<boolean>;
};

type ProjectRegistry = {
	get(id: string): Project | undefined;
	add(path: string, worktreeParentId?: string, environment?: "windows" | "wsl"): Promise<Project>;
	remove(id: string): Promise<void>;
	setWorktreeEnabled(id: string, enabled: boolean): Promise<Project | null>;
};

export type DelegationWorktreeResult = {
	rootProject: Project;
	childProject: Project;
	path: string;
	branch: string;
};

/** Coordinates PiDeck project/worktree records without reimplementing Git operations. */
export class DelegationWorktreeManager {
	constructor(
		private readonly worktree: WorktreeCreator,
		private readonly projectStore: ProjectRegistry,
		private readonly createId: () => string = randomUUID,
	) {}

	async create(parentProject: Project): Promise<DelegationWorktreeResult> {
		const rootProject = this.resolveRoot(parentProject);
		if (!rootProject || isChatProject(rootProject)) throw new Error("Delegation worktree requires a non-chat root project");
		const suffix = this.createId().replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "child";
		const branch = `delegation-implement-${suffix}`;
		const created = await this.worktree.create(rootProject.path, rootProject.id, branch);
		let childProject: Project | undefined;
		try {
			childProject = await this.projectStore.add(created.path, rootProject.id, rootProject.environment);
			if (!rootProject.worktreeEnabled) {
				const enabled = await this.projectStore.setWorktreeEnabled(rootProject.id, true);
				if (!enabled) throw new Error("Root project disappeared while enabling worktrees");
			}
			return {
				rootProject: this.projectStore.get(rootProject.id) ?? rootProject,
				childProject,
				path: created.path,
				branch: created.branch,
			};
		} catch (error) {
			try {
				await this.rollback({ rootProject, childProject, path: created.path, branch: created.branch });
			} catch {
				// Preserve the original create/register error; rollback remains user-visible recovery state.
			}
			throw error;
		}
	}

	async rollback(result: Omit<DelegationWorktreeResult, "childProject"> & { childProject?: Project }): Promise<boolean> {
		let removed = false;
		try {
			removed = await this.worktree.remove(result.path, result.rootProject.path);
		} catch {
			return false;
		}
		if (!removed) return false;
		if (result.childProject) {
			try {
				await this.projectStore.remove(result.childProject.id);
			} catch {
				return false;
			}
		}
		return true;
	}

	private resolveRoot(parentProject: Project): Project | undefined {
		let current: Project | undefined = parentProject;
		const visited = new Set<string>();
		while (current?.worktreeParentId) {
			if (visited.has(current.id)) return undefined;
			visited.add(current.id);
			current = this.projectStore.get(current.worktreeParentId);
		}
		return current;
	}
}

function isChatProject(project: Project): boolean {
	return project.kind === "chat" || project.id === "builtin-chat";
}
