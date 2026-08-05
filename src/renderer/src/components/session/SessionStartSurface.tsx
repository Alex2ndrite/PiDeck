import { useState } from "react";
import {
  ArrowUpRight,
  Bug,
  CheckSquare,
  Code2,
  ListChecks,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { t, type TranslationKey } from "../../i18n";
import { Button } from "../ui-shadcn/button";

/**
 * 新会话的工程入口：把空白时间线变成可编辑的任务选择器。
 * 快捷项使用完整 prompt 填入 composer，用户可以先调整内容，再自行确认发送。
 */
const QUICK_ACTIONS: ReadonlyArray<{
  icon: LucideIcon;
  title: TranslationKey;
  prompt: TranslationKey;
}> = [
  { icon: Search, title: "sessionStart.inspectTitle", prompt: "sessionStart.inspectPrompt" },
  { icon: ListChecks, title: "sessionStart.planTitle", prompt: "sessionStart.planPrompt" },
  { icon: Code2, title: "sessionStart.implementTitle", prompt: "sessionStart.implementPrompt" },
  { icon: Bug, title: "sessionStart.debugTitle", prompt: "sessionStart.debugPrompt" },
  { icon: CheckSquare, title: "sessionStart.testTitle", prompt: "sessionStart.testPrompt" },
  { icon: Sparkles, title: "sessionStart.reviewTitle", prompt: "sessionStart.reviewPrompt" },
];

export function SessionStartSurface(props: {
  /** 只把快捷 prompt 放入 composer，不自动发送；发送仍由用户控制。 */
  onQuickPrompt?: (prompt: string) => void;
}) {
  const [selectedPrompt, setSelectedPrompt] = useState<TranslationKey | null>(null);

  const insertPrompt = (promptKey: TranslationKey) => {
    if (!props.onQuickPrompt) return;
    props.onQuickPrompt(t(promptKey));
    setSelectedPrompt(promptKey);
  };

  return (
    <section className="session-start-surface flex min-h-full w-full items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-2xl">
        <header className="mx-auto max-w-xl text-center">
          <h1 className="text-[clamp(1.75rem,3vw,2.4rem)] font-semibold tracking-tight text-foreground">
            {t("sessionStart.title")}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            {t("sessionStart.subtitle")}
          </p>
        </header>

        <div className="mt-7">
          <div className="mb-2 px-1 text-caption font-medium text-muted-foreground">
            {t("sessionStart.quickActions")}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              const selected = selectedPrompt === action.prompt;
              return (
                <Button
                  key={action.prompt}
                  type="button"
                  variant="outline"
                  disabled={!props.onQuickPrompt}
                  aria-pressed={selected}
                  className={`group h-auto min-h-14 justify-start gap-2.5 rounded-lg border-border-subtle bg-background px-3 py-2.5 text-left shadow-none transition-[border-color,background-color,box-shadow] hover:border-border-strong hover:bg-muted/60 hover:shadow-sm${selected ? " border-border-strong bg-bg-active" : ""}`}
                  onClick={() => insertPrompt(action.prompt)}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-bg-active group-hover:text-foreground">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {t(action.title)}
                    </span>
                    <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                      {t(action.prompt)}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className={`shrink-0 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground${selected ? " text-foreground" : ""}`}
                    aria-hidden="true"
                  />
                </Button>
              );
            })}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground/80">
          {t("sessionStart.footer")}
        </p>
      </div>
    </section>
  );
}
