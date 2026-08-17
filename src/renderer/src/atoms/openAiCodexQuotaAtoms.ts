import { atom } from "jotai";
import type { OpenAiCodexQuotaResult } from "../../../shared/types";

/** 账户级配额快照：用量页与 Composer 共享这一份渲染层状态。 */
export const openAiCodexQuotaResultAtom = atom<OpenAiCodexQuotaResult | null>(null);
export const openAiCodexQuotaLoadingAtom = atom(false);
