import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { Button } from "../../ui-shadcn/button";
import { getFileIconColor, getFileIconSeti } from "../../../fileIcons";
import { t } from "../../../i18n";
import {
  GitStatus,
  type GitFileStatus,
  type GitResource,
  type GitResourceGroupType,
} from "../../../../../shared/types";
export function fileNameOnly(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * 缩短长目录路径，类似 Java package 包名缩写：取每段的首字母。
 * 例如 "src/main/java/com/example/service/impl" → "s/m/j/c/e/s/i"。
 * 短路径（≤3 段或总长 ≤20）保持原样。
 */
function shortenDir(dir: string): string {
  const parts = dir.split("/");
  if (parts.length <= 3 || dir.length <= 20) return dir;
  return parts.map((p) => p.charAt(0) || "").join("/");
}

/** 按目录分组 Git 资源，返回 { dir -> resources[] } 映射 */
function groupByDir(
	resources: GitResource[],
	/** 项目根目录，传入后目录名显示为相对路径而非绝对路径 */
	rootPath?: string,
): Map<string, GitResource[]> {
	const dirs = new Map<string, GitResource[]>();
	for (const r of resources) {
		// 将绝对路径转为相对路径，使目录分组显示简洁的相对路径而非长绝对路径
		let p = r.path;
		if (rootPath) {
			const normalizedRoot = rootPath.replace(/[\\]+/g, "/").replace(/\/+$/, "");
			const normalizedPath = p.replace(/[\\]+/g, "/");
			if (normalizedPath.startsWith(normalizedRoot + "/")) {
				p = normalizedPath.slice(normalizedRoot.length + 1);
			} else if (normalizedPath === normalizedRoot) {
				p = "";
			}
		}
		const parts = p.split(/[/\\]/);
		const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
		if (!dirs.has(dir)) dirs.set(dir, []);
		dirs.get(dir)!.push(r);
	}
	return dirs;
}

/** 收集变更列表中可折叠的目录键（单根无目录头时返回空） */
export function getCollapsibleChangeDirs(
	resources: GitResource[],
	projectRoot?: string,
): string[] {
	const byDir = groupByDir(resources, projectRoot);
	const dirs = [...byDir.keys()];
	// 与 FileTree 一致：仅一个根目录时不显示目录头，也就没有可折叠项
	if (dirs.length === 1 && dirs[0] === "") return [];
	return dirs;
}

/** 按目录树渲染文件列表 */
export function FileTree(props: {
	resources: GitResource[];
	groupType: GitResourceGroupType;
	stageFile?: (path: string) => void;
	unstageFile?: (path: string) => void;
	discardFile?: (path: string, group: "workingTree" | "untracked") => void;
	mutating: boolean;
	onOpenWorkspaceFileDiff: (group: GitResourceGroupType, path: string) => void;
	/** 项目根目录路径，用于显示相对路径 */
	projectRoot?: string;
	/** 受控：已折叠目录集合（与父级「收起/展开全部」共享） */
	collapsedDirs: Set<string>;
	onToggleDir: (dir: string) => void;
}) {
	const byDir = groupByDir(props.resources, props.projectRoot);
	// 按目录名排序，根目录排最前
	const dirs = [...byDir.keys()].sort((a, b) => {
		if (a === "") return -1;
		if (b === "") return 1;
		return a.localeCompare(b);
	});

	return (
		<>
		{dirs.map((dir) => {
			const resources = byDir.get(dir)!;
			// 单目录且无嵌套时不显示目录头
			const isSingleRoot = dirs.length === 1 && dir === "";
			return (
				<Fragment key={dir || "root"}>
					{!isSingleRoot && (
						<div
							className="flex cursor-pointer items-center gap-1 rounded-[4px] px-2 py-[3px] select-none hover:bg-[var(--git-panel-hover)]"
							onClick={() => props.onToggleDir(dir)}
						>
							<ChevronDown
								size={12}
								className={`shrink-0 text-text-tertiary transition-transform duration-150${props.collapsedDirs.has(dir) ? " -rotate-90" : " rotate-0"}`}
							/>
							<span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" title={dir || "/"}>
								{shortenDir(dir) || "/"}
							</span>
							<span className="ml-auto px-1 font-mono text-[11px] text-text-tertiary">{resources.length}</span>
						</div>
					)}
					{(!props.collapsedDirs.has(dir) || isSingleRoot) && resources.map((r) => {
						const actions: Array<{
							label: string;
							kind: "stage" | "unstage" | "discard";
							disabled?: boolean;
							run: () => void;
						}> = [];
						if (props.groupType === "index") {
							actions.push({
								label: t("git.unstage"),
								kind: "unstage",
								disabled: props.mutating,
								run: () => props.unstageFile?.(r.path),
							});
						} else if (props.groupType === "workingTree" || props.groupType === "untracked") {
							actions.push({
								label: t("git.stage"),
								kind: "stage",
								disabled: props.mutating,
								run: () => props.stageFile?.(r.path),
							});
						}
						return (
							<ResourceRow
								key={r.path}
								status={r.status}
								letter={r.letter}
								path={r.path}
								onOpen={() => props.onOpenWorkspaceFileDiff(props.groupType, r.path)}
								actions={actions}
							/>
						);
					})}
				</Fragment>
			);
		})}
		</>
	);
}

export function statusTone(
  status: GitStatus | GitFileStatus,
  isCompareContext = false,
): string {
  if (isCompareContext) {
    switch (status) {
      case "added":
        return "status-added";
      case "deleted":
        return "status-deleted";
      case "renamed":
        return "status-renamed";
      default:
        return "status-modified";
    }
  }

  switch (status) {
    case GitStatus.INDEX_ADDED:
    case GitStatus.UNTRACKED:
    case GitStatus.INTENT_TO_ADD:
      return "status-added";
    case GitStatus.INDEX_DELETED:
    case GitStatus.DELETED:
      return "status-deleted";
    case GitStatus.INDEX_RENAMED:
    case GitStatus.INDEX_COPIED:
    case GitStatus.INTENT_TO_RENAME:
      return "status-renamed";
    case GitStatus.ADDED_BY_US:
    case GitStatus.ADDED_BY_THEM:
    case GitStatus.DELETED_BY_US:
    case GitStatus.DELETED_BY_THEM:
    case GitStatus.BOTH_ADDED:
    case GitStatus.BOTH_DELETED:
    case GitStatus.BOTH_MODIFIED:
      return "status-conflicting";
    default:
      return "status-modified";
  }
}

export function compareStatusLetter(status: GitFileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

export function FileIcon({ name }: { name: string }) {
  try {
    const { svg, colorName } = getFileIconSeti(name);
    return (
      <span
        aria-hidden="true"
        className="mr-1.5 inline-flex size-5 shrink-0 items-center justify-center [&_svg]:size-full [&_svg]:fill-current"
        style={{ color: getFileIconColor(colorName) }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  } catch {
    return (
      <span aria-hidden="true" className="mr-1.5 box-border inline-flex size-3 shrink-0 items-center justify-center rounded-[4px] border border-[var(--git-desc-fg)] [&_svg]:size-full [&_svg]:fill-current" />
    );
  }
}

/** Mirrors VS Code's monaco-tl-twistie without importing structural icons. */
export function Twistie({ open }: { open: boolean }) {
  return (
    <span className={`inline-flex size-3.5 shrink-0 items-center justify-center text-[9px] text-[var(--git-desc-fg)] before:block before:content-['▶'] before:transition-transform before:duration-150${open ? " before:rotate-0" : " before:-rotate-90"}`} aria-hidden="true" />
  );
}

function GitStageGlyph({ unstage = false }: { unstage?: boolean }) {
  return (
    <span className="flex size-5 items-center justify-center font-sans text-xl font-medium leading-5 -translate-y-px" aria-hidden="true">
      {unstage ? "\u2212" : "+"}
    </span>
  );
}

export function ResourceRow(props: {
  status: GitStatus;
  letter: string;
  path: string;
  compareStatus?: GitFileStatus;
  actions?: Array<{
    label: string;
    kind: "stage" | "unstage" | "discard";
    disabled?: boolean;
    run: () => void;
  }>;
  onOpen?: () => void | Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const name = fileNameOnly(props.path);
  const tone = props.compareStatus
    ? statusTone(props.compareStatus, true)
    : statusTone(props.status);
  const letter = props.compareStatus
    ? compareStatusLetter(props.compareStatus)
    : props.letter;
  return (
    <div className={`group git-resource-row flex h-[26px] items-center pr-[7px] font-mono text-sm leading-[26px] hover:bg-[var(--git-panel-hover)] focus-within:bg-[var(--git-panel-hover)] ${tone}`} title={props.path}>
      {props.onOpen ? (
        <button
          type="button"
          className="flex h-[26px] min-w-0 flex-1 cursor-pointer appearance-none items-center border-0 bg-transparent p-0 pl-3 text-left font-inherit focus-visible:shadow-[inset_var(--focus-ring)] focus-visible:outline-none disabled:cursor-progress disabled:opacity-70"
          aria-label={t("git.openWorkspaceDiff", { path: props.path })}
          aria-busy={opening}
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            try {
              await props.onOpen?.();
            } finally {
              setOpening(false);
            }
          }}
        >
          <FileIcon name={name} />
          <span className="min-w-0 flex-[0_1_auto] truncate text-[var(--git-panel-fg)]">{name}</span>
        </button>
      ) : (
        <div className="flex h-[26px] min-w-0 flex-1 cursor-default items-center border-0 bg-transparent p-0 pl-3 text-left font-inherit">
          <FileIcon name={name} />
          <span className="min-w-0 flex-[0_1_auto] truncate text-[var(--git-panel-fg)]">{name}</span>
        </div>
      )}
      {props.actions && props.actions.length > 0 && (
        <div className="invisible mr-1 flex flex-[0_0_auto] gap-px group-hover:visible group-focus-within:visible">
          {props.actions.map((action) => (
            <Button variant="ghost" size="icon"
              key={action.kind}
              className={`size-7${action.kind === "discard" ? " hover:text-[var(--color-danger)]" : ""}`}
              aria-label={action.label} title={action.label}
              disabled={action.disabled}
              onClick={action.run}
            >
              {action.kind === "discard" ? (
                <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
              ) : (
                <GitStageGlyph unstage={action.kind === "unstage"} />
              )}
            </Button>
          ))}
        </div>
      )}
      <span className="ml-[5px] flex w-4 shrink-0 justify-end font-mono text-xs font-semibold text-right text-[var(--git-desc-fg)]" aria-hidden="true">
        {opening ? <Loader2 size={13} className="animate-spin" /> : letter}
      </span>
    </div>
  );
}

export function ResourceGroup(props: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  allAction?: () => void;
  allLabel?: string;
  allDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`border-b border-[var(--git-panel-border)] last:border-b-0${props.open ? " open" : ""}`}>
      <div className="group flex h-[22px] items-center bg-transparent px-[7px] pl-[3px] hover:bg-[var(--git-panel-hover)]">
        <button
          type="button"
          className="inline-flex h-[22px] min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0 text-left text-inherit focus-visible:shadow-[inset_var(--focus-ring)] focus-visible:outline-none"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <Twistie open={props.open} />
          <span className="ml-px min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tracking-normal uppercase text-[var(--git-panel-fg)]">{props.title}</span>
        </button>
        {props.allAction && (
          <div className="hidden items-center gap-px group-hover:flex group-focus-within:flex">
            <Button
              type="button"
              variant="ghost" size="icon-sm" className="size-7"
              aria-label={props.allLabel}
              title={props.allLabel}
              disabled={props.allDisabled}
              onClick={() => props.allAction?.()}
            >
              <GitStageGlyph unstage={props.allLabel === t("git.unstageAll")} />
            </Button>
          </div>
        )}
        <span className="ml-1 min-w-[14px] text-right font-mono text-xs text-[var(--git-desc-fg)]">{props.count}</span>
      </div>
      {props.open && (
        <div className="min-w-0">{props.children}</div>
      )}
    </div>
  );
}
