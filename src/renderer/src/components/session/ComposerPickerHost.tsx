import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { AvailableModel } from "../../../../shared/types";
import {
  sessionComposerModeByIdAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeByIdAtom,
  sessionRuntimeBySessionIdAtomFamily,
  setSessionComposerModeAtom,
  upsertSessionAtom,
} from "../../atoms";
import type { PromptTemplateInfo } from "../../composerBehavior";
import {
  ComposerModePicker,
  ModelPicker,
  PromptTemplatePicker,
  ThinkingPicker,
} from "../app/AppParts";
import { desktopApi } from "../../desktopApi";
import { showNotice } from "../../utils/notice";
import type { ComposerPickerKind } from "../../hooks/useSessionComposerController";

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
  const [models, setModels] = useState<AvailableModel[]>([]);
  const composerModes = useAtomValue(sessionComposerModeByIdAtom);
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  const modelLoadSequenceRef = useRef(0);

  useEffect(() => {
    void desktopApi.settings.get().then((settings) => {
      setFavoriteModels(settings.favoriteModels ?? []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (props.picker !== "model" || !record) return;
    const sequence = ++modelLoadSequenceRef.current;
    const handle = runtime?.agentId
      ? { agentId: runtime.agentId, generation: runtime.runtimeGeneration }
      : undefined;
    const request = handle
      ? desktopApi.agents.availableModels(handle.agentId)
      : desktopApi.projects.listModels(record.projectId);
    void request.then((next) => {
      if (sequence === modelLoadSequenceRef.current) setModels(next);
    }).catch((error) => {
      if (sequence === modelLoadSequenceRef.current) {
        setModels([]);
        showNotice(error instanceof Error ? error.message : String(error), 4000);
      }
    });
  }, [props.picker, record, runtime?.agentId, runtime?.runtimeGeneration]);

  function currentHandle() {
    const current = store.get(sessionRuntimeByIdAtom)[sessionId];
    if (!current?.agentId) return undefined;
    return {
      agentId: current.agentId,
      runtimeGeneration: current.runtimeGeneration,
    };
  }

  async function pickModel(model: AvailableModel) {
    const handle = currentHandle();
    try {
      if (handle) {
        await desktopApi.agents.setModel(handle.agentId, model.provider, model.id);
      }
      const updated = await desktopApi.sessions.updateRecord(sessionId, {
        model: { provider: model.provider, modelId: model.id },
      });
      upsertSession(updated);
      props.onClose();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function pickThinking(level: string) {
    const handle = currentHandle();
    try {
      if (handle) await desktopApi.agents.setThinking(handle.agentId, level);
      const updated = await desktopApi.sessions.updateRecord(sessionId, {
        thinkingLevel: level,
      });
      upsertSession(updated);
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
    return (
      <ModelPicker
        models={models}
        current={{
          provider: runtime?.state?.provider ?? record?.model?.provider,
          modelId: runtime?.state?.modelId ?? record?.model?.modelId,
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
        current={runtime?.state?.thinkingLevel ?? record?.thinkingLevel}
        onClose={props.onClose}
        onPick={(level) => void pickThinking(level)}
      />
    );
  }
  return null;
}
