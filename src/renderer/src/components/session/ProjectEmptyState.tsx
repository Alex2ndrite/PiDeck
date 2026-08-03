import { useEffect, useState } from "react";
import { HatGlasses, Plus } from "lucide-react";
import type { Project } from "../../../../shared/types";
import { t } from "../../i18n";
import { desktopApi } from "../../desktopApi";
import { Button } from "../ui-shadcn/button";
import { EmptyState } from "./SurfaceParts";

/**
 * 项目统一空态：普通项目与 Chat 项目在「未打开任何会话」时共享同一视图，
 * 视觉与 pi 品牌 EmptyState 完全一致（logo + tagline + subtitle + CTA）。
 *
 * - 有活动项目时提供“启动 Agent”“匿名聊天”两个快捷入口；
 * - 无项目时保留添加项目引导；
 * - 底部展示 pi 配置的默认模型与思考级别（defaultProvider/defaultModel/
 *   defaultThinkingLevel，经 renderer→preload→IPC 读取，不直接触 Node API），
 *   用户未显式选择时以 pi 配置为准，不让 welcome localStorage 覆盖。
 *
 * 复用 EmptyState 的可选 actions/footer 插槽注入业务内容，避免复制品牌结构。
 */
export function ProjectEmptyState(props: {
  activeProject?: Project;
  onCreateAgent: () => void;
  onCreateAnonymous: () => void;
  onAddProject: () => void;
}) {
  // 通过 config IPC 读取 pi 的 models.json / settings.json 默认值；读失败时静默降级为空显示。
  // parsed 来自远端配置文件，取值一律先经 unknown 收窄（typeof 守卫）再用，
  // 边界不信任远端结构（AGENTS 输入校验在边界、禁止 as 强转绕过类型错误）。
  const [defaults, setDefaults] = useState<{ model?: string; thinking?: string }>({});
  useEffect(() => {
    let alive = true;
    const apply = (model: string | undefined, thinking: string | undefined) => {
      if (alive) setDefaults({ model, thinking });
    };

    // 主进程 sessionsCatalogCreateDraft 的默认规则：优先 pi settings 的
    // defaultProvider/defaultModel，否则回退 models.json 的第一个 provider 的第一个 model。
    // 空态只做展示提示，须与主进程规则保持一致，避免“空态显示与真实默认不同”。
    void desktopApi.config
      .getSettings()
      .then(({ parsed }) => {
        // parsed 为 { defaultProvider?: unknown; defaultModel?: unknown; defaultThinkingLevel?: unknown }
        // 逐字段用 typeof 收窄为 string，未命中即视为缺省（返回 undefined）。
        const provider =
          typeof parsed.defaultProvider === "string" ? parsed.defaultProvider : undefined;
        const modelId =
          typeof parsed.defaultModel === "string" ? parsed.defaultModel : undefined;
        const thinking =
          typeof parsed.defaultThinkingLevel === "string"
            ? parsed.defaultThinkingLevel
            : undefined;
        if (provider && modelId) {
          // pi 配置同时给全 defaultProvider+defaultModel：直接用它，不再查 models.json。
          apply(`${provider}/${modelId}`, thinking);
        } else {
          // settings 未给全默认模型 → 回退 models.json 首 provider 首 model（与主进程一致）。
          void desktopApi.config
            .getModels()
            .then(({ parsed: modelsParsed }) => {
              // models.json 结构：{ providers: { [name]: { models: [{ id }] } } }
              // provider 条目除模型外还可能含密钥等敏感字段；这里只读 provider 名与 model id，
              // 绝不读取或输出其余字段，避免泄露凭据。
              const providersObj =
                modelsParsed.providers && typeof modelsParsed.providers === "object"
                  ? modelsParsed.providers
                  : null;
              const providerName = providersObj
                ? Object.keys(providersObj)[0]
                : undefined;
              const providerEntry = providerName ? providersObj?.[providerName] : undefined;
              const models =
                providerEntry && typeof providerEntry === "object" && "models" in providerEntry
                  ? providerEntry.models
                  : undefined;
              const firstModel =
                Array.isArray(models) && typeof models[0]?.id === "string"
                  ? models[0].id
                  : undefined;
              apply(
                providerName && firstModel ? `${providerName}/${firstModel}` : undefined,
                thinking,
              );
            })
            .catch(() => {
              // models.json 不可读时仅保留 settings 里的思考级别；空态不阻塞。
              apply(undefined, thinking);
            });
        }
      })
      .catch(() => {
        // 配置不可读（非 Electron/网络预览环境）时保持默认空；空态不阻塞。
      });
    return () => {
      alive = false;
    };
  }, []);

  const hasProject = Boolean(props.activeProject);

  return (
    // chat-pane 为 flex 列容器：EmptyState 的 .empty-state 自带 height:100%，
    // 外层保持纯 flex 子项（min-h-0 允许收缩），避免再包一层固定高度导致品牌区不居中。
    <div className="flex min-h-0 flex-1 flex-col">
      <EmptyState
        hasProject={hasProject}
        onCreate={props.onCreateAgent}
        actions={
          hasProject ? (
            <div className="empty-state-actions flex flex-wrap items-center justify-center gap-2">
              <Button variant="default" className="empty-state-cta" onClick={props.onCreateAgent}>
                <Plus className="size-3.5" aria-hidden="true" /><span>{t("app.createAgent")}</span>
              </Button>
              <Button variant="outline" onClick={props.onCreateAnonymous}>
                <HatGlasses className="size-3.5" aria-hidden="true" /><span>{t("app.anonymousChat")}</span>
              </Button>
            </div>
          ) : (
            <Button variant="default" className="empty-state-cta" onClick={props.onAddProject}>
              <Plus className="size-3.5" aria-hidden="true" /><span>{t("app.addProject")}</span>
            </Button>
          )
        }
        footer={
          // 底部 pi 配置默认值提示（仅在存在活动项目时展示）
          (defaults.model || defaults.thinking) && hasProject ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {defaults.model && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground/70">{t("app.model")}:</span>
                  <span className="font-mono">{defaults.model}</span>
                </span>
              )}
              {defaults.thinking && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground/70">{t("app.think")}:</span>
                  <span className="font-mono">{defaults.thinking}</span>
                </span>
              )}
            </span>
          ) : null
        }
      />
    </div>
  );
}
