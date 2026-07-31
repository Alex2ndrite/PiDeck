import type { ReactNode } from "react";

/**
 * 抽屉活动栏动作项：由 App 层组装（复用与 outline 相同的打开/关闭语义），
 * rail 本体只负责渲染与激活态展示，不感知具体面板业务。
 */
export type WorkspaceDrawerRailAction = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
};

/**
 * 右侧抽屉的活动栏（activity rail）。
 * 新架构下面板切换入口从「会话 outline 浮动按钮」下沉到抽屉自身：
 * 抽屉打开期间始终可见，无活跃会话时也能切换 files/git/browser，
 * 不依赖 outline 是否渲染。
 */
export function WorkspaceDrawerRail(props: { actions: WorkspaceDrawerRailAction[] }) {
  if (props.actions.length === 0) return null;
  return (
    <div className="drawer-activity-rail" role="tablist" aria-orientation="horizontal">
      {props.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="tab"
          aria-selected={action.active}
          data-testid={`drawer-rail-${action.id}`}
          className={`drawer-activity-rail-button${action.active ? " active" : ""}`}
          title={action.label}
          aria-label={action.label}
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
