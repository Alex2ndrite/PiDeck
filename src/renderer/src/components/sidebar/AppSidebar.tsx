import React from "react";
import { useSetAtom } from "jotai";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SidebarContent, type SidebarActions } from "./SidebarContent";
import { useSidebarController } from "../../hooks/useSidebarController";
import { BrandLockup } from "../app/AppParts";
import { t } from "../../i18n";
import { settingsOpenAtom } from "../../atoms";

interface AppSidebarProps {
  actions: SidebarActions;
  currentProjectId: string | undefined;
  currentSessionId: string | undefined;
  worktreesByProject: Record<string, any[]>;
  branchByProject: Record<string, string | null>;
  creatingWorktree: boolean;
  isLanWeb: boolean;
  listCollapsed: boolean;
  listHoverRevealSuppressed: boolean;
  onToggleListCollapsed: () => void;
  onPointerLeave: () => void;
  onOpenConfig: () => void;
  onOpenFeedback: () => void;
  onOpenHomepage: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const controller = useSidebarController({
    getRpcLogging: props.actions.rpc.getLogging,
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
        <button
          className="collapse-button list-collapse"
          title={props.listCollapsed ? t("app.expandList") : t("app.collapseList")}
          onClick={props.onToggleListCollapsed}
        >
          {props.listCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </>}
      onPointerLeave={props.onPointerLeave}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenConfig={props.onOpenConfig}
      onOpenFeedback={props.onOpenFeedback}
      onOpenHomepage={props.onOpenHomepage}
    />
  );
}
