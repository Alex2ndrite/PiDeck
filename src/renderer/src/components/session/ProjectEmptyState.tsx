import { Fragment, useEffect, useRef, useState } from "react";
import { Brain, Check, HatGlasses, Plus, Sparkles } from "lucide-react";
import type { AvailableModel, Project } from "../../../../shared/types";
import { t, type TranslationKey } from "../../i18n";
import { desktopApi } from "../../desktopApi";
import { Button } from "../ui-shadcn/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui-shadcn/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "../ui-shadcn/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui-shadcn/popover";
import { WELCOME_MODEL_KEY, WELCOME_THINKING_KEY } from "../../utils/chatSessionBootstrap";
import { EmptyState } from "./SurfaceParts";
import { THINKING_LEVELS, groupModelsByProvider } from "./sessionPickerOptions";

const THINKING_LABEL_KEYS: Record<string, TranslationKey> = {};
for (const level of THINKING_LEVELS) {
  THINKING_LABEL_KEYS[level.value] = level.labelKey;
}

function thinkingLabel(level: string) {
  return t(THINKING_LABEL_KEYS[level] ?? THINKING_LABEL_KEYS.medium);
}

/**
 * 项目启动面板：在用户还没有会话时提供明确的工程入口与启动前配置。
 *
 * 有活动项目时展示持久会话、临时对话和模型/思考级别选择；无项目时只保留添加项目入口。
 * 模型与思考级别沿用欢迎页偏好键，确保用户配置会被下一次创建会话使用。
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
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelChoice, setModelChoice] = useState("");
  const [thinkingChoice, setThinkingChoice] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const selectedModelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let alive = true;
    void desktopApi.projects.listModels(props.activeProject?.id).then((items) => {
      if (alive) setModels(items);
    }).catch(() => undefined);
    const apply = (model: string | undefined, thinking: string | undefined) => {
      if (alive) {
        setModelChoice(model ?? "");
        setThinkingChoice(thinking ?? "medium");
      }
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

  const groupedModels = groupModelsByProvider(models);

  useEffect(() => {
    if (!modelPickerOpen || !modelChoice || !selectedModelRef.current) return;
    // cmdk 会把当前项带入可视区，但默认位置可能贴着列表底边；按几何位置校正到视口中央，
    // 让用户打开长列表时第一眼就能确认当前模型，不依赖浏览器的 scrollIntoView 对嵌套 Portal 的猜测。
    const frame = requestAnimationFrame(() => {
      const item = selectedModelRef.current;
      const list = item?.closest<HTMLElement>("[data-slot=command-list]");
      if (!item || !list) return;
      const itemRect = item.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      list.scrollTop += itemRect.top - (listRect.top + (listRect.height - itemRect.height) / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, [modelPickerOpen, modelChoice, models]);

  const saveModelChoice = (value: string) => {
    setModelChoice(value);
    const model = models.find((item) => `${item.provider}/${item.id}` === value);
    if (!model) return;
    try {
      localStorage.setItem(WELCOME_MODEL_KEY, JSON.stringify({ provider: model.provider, modelId: model.id }));
    } catch {
      // 选择仍保留在当前页面；存储不可用时启动流程会回退到 pi 默认值。
    }
  };

  const saveThinkingChoice = (value: string) => {
    setThinkingChoice(value);
    try {
      localStorage.setItem(WELCOME_THINKING_KEY, value);
    } catch {
      // 启动时仍会使用 pi 配置中的思考级别。
    }
  };

  return (
    // chat-pane 为 flex 列容器：EmptyState 的 .empty-state 自带 height:100%，
    // 外层保持纯 flex 子项（min-h-0 允许收缩），避免再包一层固定高度导致品牌区不居中。
    <div className="flex min-h-0 flex-1 flex-col">
      <EmptyState
        hasProject={hasProject}
        onCreate={props.onCreateAgent}
        actions={
          hasProject ? (
            <div className="flex w-full max-w-[560px] flex-col gap-4">
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button variant="outline" size="lg" className="h-10 min-w-40 justify-center rounded-lg border-border-strong bg-muted/50 px-4 text-foreground shadow-none hover:bg-bg-active" onClick={props.onCreateAgent}>
                  <Sparkles className="size-4" aria-hidden="true" />{t("app.createAgent")}
                </Button>
                <Button variant="outline" size="lg" className="h-10 min-w-40 justify-center rounded-lg bg-background px-4 text-foreground shadow-none hover:bg-bg-active" onClick={props.onCreateAnonymous}>
                  <HatGlasses className="size-4" aria-hidden="true" />{t("app.anonymousChatShort")}
                </Button>
              </div>
              <div className="grid w-full grid-cols-1 items-center gap-1.5 rounded-lg border border-border-subtle bg-muted/35 p-1.5 shadow-none sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                <span className="px-2 text-caption font-medium text-text-secondary">{t("app.emptyStartWith")}</span>
                {/* 两个控件必须共享固定外框；!h-11/!w-full 会覆盖 SelectTrigger 默认的 data-size 与 w-fit，避免仅看 grid 列宽却出现实际边界不一致。 */}
                <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="lg"
                      className="!h-10 !w-full rounded-md border-border-subtle bg-background px-3 font-normal shadow-none hover:bg-bg-active"
                      title={modelChoice || t("app.model")}
                    >
                      <span className="truncate">{modelChoice || t("app.model")}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[min(380px,calc(100vw-48px))] p-0">
                    <Command defaultValue={modelChoice}>
                      <CommandInput placeholder={t("app.modelPickerSearch")} autoFocus />
                      <CommandList>
                        <CommandEmpty>{t("app.modelPickerEmpty")}</CommandEmpty>
                        {Object.entries(groupedModels).map(([provider, providerModels], providerIndex) => (
                          <Fragment key={provider}>
                            <CommandGroup heading={`${provider} (${providerModels.length})`}>
                              {providerModels.map((model) => {
                              const value = `${model.provider}/${model.id}`;
                              return (
                                <CommandItem
                                  key={value}
                                  value={value}
                                  onSelect={() => {
                                    saveModelChoice(value);
                                    setModelPickerOpen(false);
                                  }}
                                  ref={value === modelChoice ? selectedModelRef : undefined}
                                  className="items-start py-2"
                                >
                                  <span className="min-w-0 flex-1 break-words">{value}</span>
                                  <Check className={`mt-0.5 shrink-0 ${value === modelChoice ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                                </CommandItem>
                              );
                              })}
                            </CommandGroup>
                            {providerIndex < Object.keys(groupedModels).length - 1 && <CommandSeparator />}
                          </Fragment>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Select value={thinkingChoice} onValueChange={saveThinkingChoice}>
                  <SelectTrigger size="sm" className="!h-10 !w-full min-w-0 rounded-md border-border-subtle bg-background px-3 hover:bg-bg-active">
                    <Brain aria-hidden="true" />
                    <SelectValue placeholder={t("app.think")} />
                  </SelectTrigger>
                  <SelectContent>
                      {THINKING_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>{thinkingLabel(level.value)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="border-border-strong bg-muted/50 text-foreground shadow-none hover:bg-bg-active" onClick={props.onAddProject}>
              <Plus className="size-3.5" aria-hidden="true" /><span>{t("app.addProject")}</span>
            </Button>
          )
        }

      />
    </div>
  );
}
