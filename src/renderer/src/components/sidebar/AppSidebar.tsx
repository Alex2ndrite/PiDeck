import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SidebarContent, type SidebarActions } from "./SidebarContent";
import type { SidebarController } from "../../hooks/useSidebarController";
import { LogoMark } from "../app/AppParts";
import { t } from "../../i18n";
import type { SessionSummary, Project } from "../../../../shared/types";

interface AppSidebarProps {
  controller: SidebarController;
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
  onOpenSettings: () => void;
  onOpenConfig: () => void;
  onOpenFeedback: () => void;
  onOpenHomepage: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <SidebarContent
      controller={props.controller}
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
            <LogoMark />
            <span className="brand-wordmark" aria-label="PiDeck">PiDeck</span>
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
      onOpenSettings={props.onOpenSettings}
      onOpenConfig={props.onOpenConfig}
      onOpenFeedback={props.onOpenFeedback}
      onOpenHomepage={props.onOpenHomepage}
    />
  );
}
