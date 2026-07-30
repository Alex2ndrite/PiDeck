import React, { useRef } from "react";
import { useSetAtom } from "jotai";
import { SidebarContent, type SidebarActions } from "./SidebarContent";
import { useSidebarController } from "../../hooks/useSidebarController";
import { BrandLockup } from "../app/AppParts";
import { settingsOpenAtom } from "../../atoms";
import { desktopApi } from "../../desktopApi";

interface AppSidebarProps {
  actions: SidebarActions;
  currentProjectId: string | undefined;
  currentSessionId: string | undefined;
  worktreesByProject: Record<string, any[]>;
  branchByProject: Record<string, string | null>;
  creatingWorktree: boolean;
  isLanWeb: boolean;
  onOpenConfig: () => void;
  onOpenFeedback: () => void;
  onOpenHomepage: () => void;
  /** settings.json 中已保存的展开项目 id，权威来源 */
  settingsExpandedProjectIds?: readonly string[];
  /** 首次 settings.get 已完成，controller 可安全处理旧 key 迁移。 */
  settingsLoaded: boolean;
  /** 展开集合完成权威 hydration 后，允许 App 按它懒加载会话。 */
  onExpandedProjectsReady: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  // 快速连续点击展开/折叠会触发多次 IPC；按顺序写入可避免旧请求最后完成后覆盖新集合。
  const expandedProjectsSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const controller = useSidebarController({
    getRpcLogging: props.actions.rpc.getLogging,
    settingsExpandedProjectIds: props.settingsExpandedProjectIds,
    settingsLoaded: props.settingsLoaded,
    onExpandedProjectsReady: props.onExpandedProjectsReady,
    persistExpandedProjectIds: (projectIds) => {
      expandedProjectsSaveQueueRef.current = expandedProjectsSaveQueueRef.current
        .catch(() => undefined)
        .then(() => desktopApi.settings.update({ sidebarExpandedProjectIds: projectIds }))
        .catch(() => undefined);
    },
  });

  return (
    <SidebarContent
      controller={controller}
      actions={props.actions}
      currentProjectId={props.currentProjectId}
      currentSessionId={props.currentSessionId}
      worktreesByProject={props.worktreesByProject}
      branchByProject={props.branchByProject}
      creatingWorktree={props.creatingWorktree}
      isLanWeb={props.isLanWeb}
      chrome={<>
        <div className="list-toolbar">
          <div className="app-badge">
            <BrandLockup />
          </div>
        </div>
      </>}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenConfig={props.onOpenConfig}
      onOpenFeedback={props.onOpenFeedback}
      onOpenHomepage={props.onOpenHomepage}
    />
  );
}
