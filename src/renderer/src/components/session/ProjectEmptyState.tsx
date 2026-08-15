import { useEffect, useRef } from "react";
import { FolderGit2, HatGlasses, Plus, Sparkles } from "lucide-react";
import type { Project } from "../../../../shared/types";
import { t } from "../../i18n";
import { isChatProject } from "../../rendererUtils";
import { Button } from "../ui-shadcn/button";
import { LogoMark } from "./SurfaceParts";

/**
 * 项目启动入口：用户还没有会话时，提供明确的创建入口。
 *
 * 点击「新建 Agent / 匿名聊天」创建会话后，主面板切到新会话，
 * 由 SessionStartSurface（居中 ComposerArea）接管输入——模型/思考级别等
 * 启动配置在输入框底部栏选择，本页不再重复造一套控件。
 * 无项目时只保留添加项目入口。
 */
export function ProjectEmptyState(props: {
  activeProject?: Project;
  /**
   * 自动创建闸门：仅当用户亲手清空 Tab 栏（App 经
   * useSessionWorkspaceChrome.allTabsClosedByUser 传入）后才允许挂载即创建。
   * 启动时首项目（内置 Chat 恒排第一）被自动选中同样会挂载本页，但那是无用户
   * 意图的引导页——自动创建会让每次启动都新建匿名会话并拉起 pi agent。
   */
  autoCreateOnMount?: boolean;
  onCreateAgent: () => void;
  onCreateAnonymous: () => void;
  onAddProject: () => void;
}) {
  const hasProject = Boolean(props.activeProject);

  // 关闭全部 Tab 后的空态也直接进新会话输入页：闸门通过且有项目时，挂载即
  // 自动创建 draft（Chat 项目为匿名）会话，创建成功后 currentSessionId 变化 →
  // App 切到 SessionStartSurface（居中 ComposerArea），本页随之卸载。重复创建由
  // useSessionActions 的 creatingSessionDraftRef（按 projectId 并发防重）兜底。
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (!props.autoCreateOnMount || !props.activeProject || autoCreatedRef.current) return;
    autoCreatedRef.current = true;
    if (isChatProject(props.activeProject)) {
      props.onCreateAnonymous();
    } else {
      props.onCreateAgent();
    }
  }, [props.autoCreateOnMount, props.activeProject, props.onCreateAgent, props.onCreateAnonymous]);

  // 取路径末段作为页眉的项目名，与侧栏项目行的命名口径一致。
  const activeProjectName = props.activeProject
    ? props.activeProject.path.split(/[\\/]/).filter(Boolean).pop() ?? props.activeProject.path
    : "";

  return (
    // chat-pane 为 flex 列容器：内容区 flex-1 垂直居中；pt-[14vh] 与起始页
    // 相同的重心下移，创建后切换到 SessionStartSurface 时视觉连贯不跳动
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-6 pb-10 pt-[14vh]">
        <div className="flex flex-col items-center gap-2.5">
          <LogoMark size={56} />
          {hasProject && (
            <span className="flex max-w-56 items-center gap-1.5 truncate text-[13px] text-text-secondary">
              <FolderGit2 size={13} aria-hidden="true" className="shrink-0 text-text-tertiary" />
              <span className="truncate">{activeProjectName}</span>
            </span>
          )}
        </div>

        {hasProject ? (
          /* 创建入口：主按钮用前景/背景反色（浅色下纯黑、暗色下纯白），
             次入口降级为下划线文本；创建后即进入居中输入框起始页 */
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Button
              size="lg"
              className="h-12 rounded-xl bg-foreground px-7 text-background shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)] transition-all duration-200 hover:-translate-y-px hover:bg-foreground/85 hover:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.4)]"
              onClick={props.onCreateAgent}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {t("app.createAgent")}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="group h-auto px-0 text-sm font-normal text-text-secondary hover:bg-transparent hover:text-foreground"
              onClick={props.onCreateAnonymous}
            >
              <HatGlasses className="size-4" aria-hidden="true" />
              <span className="underline decoration-border-strong underline-offset-4 group-hover:decoration-foreground">
                {t("app.anonymousChatShort")}
              </span>
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            className="h-12 rounded-xl bg-foreground px-7 text-background shadow-sm hover:bg-foreground/85"
            onClick={props.onAddProject}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>{t("app.addProject")}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
