export type TerminalShell =
	| "pwsh"
	| "powershell"
	| "cmd"
	| "zsh"
	| "bash"
	| "fish"
	| "sh"
	| "git-bash"
	| "wsl";

export type TerminalShellCandidate = {
	shell: TerminalShell;
	label: string;
	available: boolean;
	path?: string;
};

export type TerminalTab = {
	id: string;
	agentId: string;
	title: string;
	cwd: string;
	shell: TerminalShell;
	createdAt: number;
	exited?: boolean;
	exitCode?: number;
	buffer?: string;
};

export type TerminalDataEvent = {
	tabId: string;
	data: string;
};

export type TerminalExitEvent = {
	tabId: string;
	exitCode?: number;
};
