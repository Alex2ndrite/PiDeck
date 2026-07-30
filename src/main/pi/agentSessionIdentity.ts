import type { CreateAgentInput, SessionEnvironment } from "../../shared/types";
import { buildSessionOriginKey } from "../../shared/sessionIdentity";

export type AgentSessionIdentityDefaults = {
  environment: SessionEnvironment;
  wslDistro?: string;
  wslUser?: string;
};

export function buildAgentSessionKey(
  input: CreateAgentInput,
  defaults: AgentSessionIdentityDefaults,
): string | undefined {
  if (!input.sessionPath) return undefined;
  const environment = input.environment ?? defaults.environment;
  return buildSessionOriginKey({
    source: input.source ?? "pi",
    environment,
    filePath: input.sessionPath,
    wslDistro:
      input.wslDistro ?? (environment === "wsl" ? defaults.wslDistro : undefined),
    wslUser:
      input.wslUser ?? (environment === "wsl" ? defaults.wslUser : undefined),
    importedSourceId: input.importedSourceId,
  });
}
