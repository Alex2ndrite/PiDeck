import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { AvailableModel, SessionRuntimeTarget } from "../../../../shared/types";
import {
  sessionComposerModeByIdAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeByIdAtom,
  sessionRuntimeBySessionIdAtomFamily,
  setSessionComposerModeAtom,
  thinkingLevelPendingByIdAtom,
  upsertSessionAtom,
} from "../../atoms";
import type { PromptTemplateInfo } from "../../composerBehavior";
import {
  ComposerModePicker,
  ModelPicker,
  PromptTemplatePicker,
  ThinkingPicker,
} from "./ComposerParts";
import { desktopApi } from "../../desktopApi";
import { showNotice } from "../../utils/notice";
import { t } from "../../i18n";
import {
  SessionCommandFailure,
  requireSessionCommand,
  toSessionRuntimeTarget,
} from "../../utils/sessionCommands";
import { ConfirmDialog } from "../app/AppParts";
import type { ComposerPickerKind } from "../../hooks/useSessionComposerController";
import { WELCOME_MODEL_KEY, WELCOME_THINKING_KEY, readWelcomeModelPreference, readWelcomeThinkingPreference } from "../../utils/chatSessionBootstrap";

export type ComposerPickerHostProps = {
  sessionId: string;
  picker: ComposerPickerKind | null;
  templates: PromptTemplateInfo[];
  onClose: () => void;
  onInsertTemplate: (template: PromptTemplateInfo) => void;
};

export function ComposerPickerHost(props: ComposerPickerHostProps) {
  const { sessionId } = props;
  const store = useStore();
  const record = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  const setMode = useSetAtom(setSessionComposerModeAtom);
  const upsertSession = useSetAtom(upsertSessionAtom);
  const thinkingPending = useAtomValue(thinkingLevelPendingByIdAtom)[sessionId];
  const setThinkingPendingMap = useSetAtom(thinkingLevelPendingByIdAtom);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const composerModes = useAtomValue(sessionComposerModeByIdAtom);
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  const [planModeAvailable, setPlanModeAvailable] = useState(true);
  const modelLoadSequenceRef = useRef(0);
  /** 模型在本地 models.json 存在但运行中 Agent 未加载：待确认重启的目标。 */
  const [restartTarget, setRestartTarget] = useState<{
    handle: SessionRuntimeTarget;
    model: string;
  } | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void desktopApi.settings.get().then((settings) => {
      setFavoriteModels(settings.favoriteModels ?? []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (props.picker !== "mode") return;
    // 计划模式由内置扩展提供；每次打开模式选择器读取最新状态，避免禁用扩展后仍显示过期选项。
    const extensionsApi = (window as unknown as {
      piDesktop?: { extensions?: { list: () => Promise<{ extensions: Array<{ source: string; enabled?: boolean; builtIn?: boolean }> }> } };
    }).piDesktop?.extensions;
    if (!extensionsApi) return;
    void extensionsApi.list().then((result) => {
      const plan = result.extensions.find((extension) => extension.source === "pi-deck-plan-mode.ts");
      const available = plan?.enabled !== false;
      setPlanModeAvailable(available);
      // 扩展被禁用后清理残留的计划模式状态，避免下拉隐藏但编辑器仍保持计划模式。
      if (!available && composerModes[sessionId] === "plan") setMode({ sessionId, mode: "normal" });
    }).catch(() => {
      setPlanModeAvailable(false);
      if (composerModes[sessionId] === "plan") setMode({ sessionId, mode: "normal" });
    });
  }, [composerModes, props.picker, sessionId, setMode]);

  useEffect(() => {
    // 打开模型选择器即加载（不依赖 record：欢迎页/未启动 Agent 时 record 为 undefined，
    // 但模型列表是全量的，listModels 不依赖 projectId）。
    if (props.picker !== "model") return;
    const sequence = ++modelLoadSequenceRef.current;
    // Always read models.json directly — same source as Agent RPC, no transition flicker
    void desktopApi.projects.listModels(record?.projectId).then((next) => {
      if (sequence === modelLoadSequenceRef.current) setModels(next);
    }).catch((error) => {
      if (sequence === modelLoadSequenceRef.current) {
        setModels([]);
        showNotice(error instanceof Error ? error.message : String(error), 4000);
      }
    });
  }, [props.picker, record]);

  function currentHandle() {
    const current = store.get(sessionRuntimeByIdAtom)[sessionId];
    return toSessionRuntimeTarget(sessionId, current);
  }

  /**
   * 运行时代理命令失败时，若错误是「运行时不可用/绑定已变化」（例如 Agent 已被关闭、
   * 或历史会话尚未启动 Agent），降级为只更新会话记录。Agent 下次启动时
   * SessionRuntimeCoordinator.applyPreferences 会把记录里的模型应用到新进程。
   */
  function isStaleRuntimeFailure(error: unknown): boolean {
    return error instanceof SessionCommandFailure &&
      (error.code === "SESSION_RUNTIME_UNAVAILABLE" ||
        error.code === "SESSION_RUNTIME_CHANGED");
  }

  async function applyModelToRecord(model: AvailableModel) {
    const updated = await desktopApi.sessions.updateRecord(sessionId, {
      model: { provider: model.provider, modelId: model.id },
    });
    upsertSession(updated);
  }

  async function pickModel(model: AvailableModel) {
    // 欢迎页/未启动 Agent（无 record）：把选择存本地偏好，点「启动 Agent」创建会话时应用。
    if (!record) {
      try {
        localStorage.setItem(WELCOME_MODEL_KEY, JSON.stringify({
          provider: model.provider,
          modelId: model.id,
        }));
      } catch {
        // localStorage 不可用时静默；创建会话回退到 pi 默认模型
      }
      props.onClose();
      return;
    }
    const handle = currentHandle();
    try {
      if (handle) {
        try {
          const result = requireSessionCommand(await desktopApi.sessions.setRuntimeModel(
            handle,
            model.provider,
            model.id,
          ));
          upsertSession({
            ...record,
            model: { provider: model.provider, modelId: model.id },
            updatedAt: Date.now(),
          });
          // 立即将返回的 AgentRuntimeState 合并到 runtime state atom，
          // 使底部栏的模型名称、provider 即刻刷新，无需等待 emitState 事件
          const agentState = result.value;
          const current = store.get(sessionRuntimeByIdAtom)[sessionId];
          if (current) {
            store.set(sessionRuntimeByIdAtom, {
              ...store.get(sessionRuntimeByIdAtom),
              [sessionId]: {
                ...current,
                state: current.state
                  ? { ...current.state, ...agentState }
                  : agentState,
              },
            });
          }
        } catch (error) {
          // 运行时代理不可用（Agent 已关/绑定已换）时降级写记录，
          // 保证「先选模型、后启动 Agent」的流程始终可用。
          if (!isStaleRuntimeFailure(error)) throw error;
          await applyModelToRecord(model);
        }
      } else {
        await applyModelToRecord(model);
      }
      props.onClose();
    } catch (error) {
      // 模型在本地 models.json 存在但运行中 Agent 快照未加载（pi set_model 校验失败）：
      // 关闭选择器并提示用户重启 Agent 使新模型生效，而非直接报错。
      if (error instanceof SessionCommandFailure && error.needsRestart && handle) {
        props.onClose();
        setRestartTarget({
          handle,
          model: `${model.provider}/${model.id}`,
        });
        return;
      }
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    }
  }

  /** 重启 Agent 使新模型生效（新 pi 进程会重新加载 models.json）。 */
  async function confirmRestart() {
    if (!restartTarget || restarting) return;
    setRestarting(true);
    try {
      await desktopApi.sessions.restartRuntime(restartTarget.handle);
      showNotice(t("app.modelRestartDone"), 3000);
      props.onClose();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setRestarting(false);
      setRestartTarget(null);
    }
  }

  async function pickThinking(level: string) {
    // 欢迎页/未启动 Agent（无 record）：把选择存本地偏好，点「启动 Agent」创建会话时应用。
    if (!record) {
      try {
        localStorage.setItem(WELCOME_THINKING_KEY, level);
      } catch {
        // localStorage 不可用时静默
      }
      props.onClose();
      return;
    }
    const handle = currentHandle();
    try {
      if (handle) {
        try {
          const result = requireSessionCommand(await desktopApi.sessions.setRuntimeThinking(handle, level));
          upsertSession({ ...record, thinkingLevel: level, updatedAt: Date.now() });
          // 生成进行中：飞行中的生成仍用旧档位，新档位下一轮才生效。
          // 记录待生效指示（issue #146：xhigh->max），由 ComposerArea 在流式结束时清除。
          if (runtime?.state?.isStreaming) {
            const from = thinkingPending?.from ?? runtime.state.thinkingLevel ?? record.thinkingLevel;
            if (from && from !== level) {
              setThinkingPendingMap((prev) => ({ ...prev, [sessionId]: { from, to: level } }));
            }
          }
          // 立即将返回的 AgentRuntimeState 合并到 runtime state atom，
          // 使底部栏的思考强度即刻刷新
          const agentState = result.value;
          const current = store.get(sessionRuntimeByIdAtom)[sessionId];
          if (current) {
            store.set(sessionRuntimeByIdAtom, {
              ...store.get(sessionRuntimeByIdAtom),
              [sessionId]: {
                ...current,
                state: current.state
                  ? { ...current.state, ...agentState }
                  : agentState,
              },
            });
          }
        } catch (error) {
          // 与模型选择同一策略：运行时不可用时降级为写记录，启动时生效
          if (!isStaleRuntimeFailure(error)) throw error;
          const updated = await desktopApi.sessions.updateRecord(sessionId, {
            thinkingLevel: level,
          });
          upsertSession(updated);
        }
      } else {
        const updated = await desktopApi.sessions.updateRecord(sessionId, {
          thinkingLevel: level,
        });
        upsertSession(updated);
      }
      props.onClose();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function toggleFavorite(provider: string, modelId: string) {
    const key = `${provider}/${modelId}`;
    const next = favoriteModels.includes(key)
      ? favoriteModels.filter((item) => item !== key)
      : [...favoriteModels, key];
    setFavoriteModels(next);
    try {
      await desktopApi.settings.update({ favoriteModels: next });
    } catch (error) {
      setFavoriteModels(favoriteModels);
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    }
  }

  if (props.picker === "template") {
    return (
      <PromptTemplatePicker
        templates={props.templates}
        onClose={props.onClose}
        onPick={props.onInsertTemplate}
      />
    );
  }
  if (props.picker === "model") {
    const welcomeModel = readWelcomeModelPreference()?.model;
    return (
      <ModelPicker
        models={models}
        current={{
          provider: runtime?.state?.provider ?? record?.model?.provider ?? welcomeModel?.provider,
          modelId: runtime?.state?.modelId ?? record?.model?.modelId ?? welcomeModel?.modelId,
          modelName: runtime?.state?.modelName,
        }}
        onClose={props.onClose}
        onPick={(model) => void pickModel(model)}
        favoriteModels={favoriteModels}
        onToggleFavorite={(provider, modelId) => void toggleFavorite(provider, modelId)}
      />
    );
  }
  if (props.picker === "mode") {
    return (
      <ComposerModePicker
        currentMode={composerModes[sessionId] ?? "normal"}
        onClose={props.onClose}
        planModeAvailable={planModeAvailable}
        onPick={(nextMode) => {
          setMode({ sessionId, mode: nextMode });
          props.onClose();
        }}
      />
    );
  }
  if (props.picker === "thinking") {
    return (
      <ThinkingPicker
        current={runtime?.state?.thinkingLevel ?? record?.thinkingLevel ?? readWelcomeThinkingPreference()?.thinkingLevel}
        onClose={props.onClose}
        onPick={(level) => void pickThinking(level)}
      />
    );
  }
  return (
    <>
      {null}
      {restartTarget && (
        <ConfirmDialog
          title={t("app.modelRestartTitle")}
          message={t("app.modelRestartBody", { model: restartTarget.model })}
          confirmLabel={t("common.confirm")}
          onConfirm={() => void confirmRestart()}
          onCancel={() => setRestartTarget(null)}
        />
      )}
    </>
  );
}
