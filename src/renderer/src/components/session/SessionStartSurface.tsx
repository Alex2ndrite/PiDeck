import { useRef, type ReactNode } from "react";
import {
  Bug,
  CheckSquare,
  Code2,
  ListChecks,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { t, type TranslationKey } from "../../i18n";
import { useSessionPaneServices } from "./SessionPaneServices";
import { ComposerArea } from "./ComposerArea";
import { QueuedPromptPanel } from "./ComposerPanels";
import { LogoMark } from "./SurfaceParts";

/**
 * 新会话起始页（DeepSeek 式居中输入框）：匿名/新会话还没有消息时，
 * 页面中央直接挂完整的 ComposerArea——模型/思考级别/模式/发送/附件/
 * 安全级别等一切能力都是现成的（services 经 context 注入，零透传），
 * 不再为起始页维护第二套输入框实现。
 *
 * 底部 composer 面板在无消息时不渲染（SessionView 按 messages.length 判断），
 * 避免同屏出现两个输入框；发送后消息出现，居中页自动退出。
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
  sessionId: string;
  /** 可选项目切换器：引导页（无会话空态）传入，标明并可切换下一次发送将会话创建到哪个项目 */
  projectSwitcher?: ReactNode;
}) {
  const services = useSessionPaneServices();
  const queuedTrackRef = useRef<HTMLDivElement | null>(null);
  const activeQueuedPrompts = services.queuedPromptsBySession[props.sessionId] ?? [];

  return (
    // session-start-surface 保留类名供壁纸模式契约（bg-transparent 透出下层壁纸）；
    // pt-[18vh] 把重心压向视口中心（输入框顶约 36-40%、框心 ~55%），接近 DeepSeek
    // 新会话页；[--font-size-input] 在容器作用域放大输入框字号（14→15.5px），
    // 只影响本页，不改全局 token（会话页输入框保持原尺寸）。
    <div className="session-start-surface flex min-h-full w-full flex-col items-center gap-8 bg-transparent px-6 pb-10 pt-[18vh] [--font-size-input:15.5px] [--line-height-input:25px]">
      <LogoMark size={72} />
      {props.projectSwitcher}
      {/* 复用会话页底部输入框组件：defaultHeight 抬高起步高度（300px），
          底部栏（模型/思考/模式/安全级别/git）与发送按钮全保留 */}
      <div className="w-full max-w-[980px]">
        <ComposerArea
          sessionId={props.sessionId}
          defaultHeight={300}
          gitInfo={services.gitInfo}
          onOpenFile={services.onOpenFile}
          enqueue={services.enqueueSessionPrompt}
          ensureSessionId={services.ensureSessionId}
          queuePanel={
            <QueuedPromptPanel
              trackRef={queuedTrackRef}
              sessionId={props.sessionId}
              prompts={activeQueuedPrompts}
              visiblePrompts={activeQueuedPrompts}
              onRetract={services.queueRetract}
              onDiscard={services.queueDiscard}
            />
          }
        />
      </div>

      {/* 快捷项：点击填入输入框不自动发送，用户可先调整（沿用 services 的草稿写入） */}
      <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-text-secondary transition-colors hover:border-border-strong hover:text-foreground"
            onClick={() => {
              services.insertQuickPrompt(props.sessionId, t(action.prompt));
            }}
          >
            <action.icon size={15} aria-hidden="true" className="text-text-tertiary" />
            {t(action.title)}
          </button>
        ))}
      </div>
    </div>
  );
}
