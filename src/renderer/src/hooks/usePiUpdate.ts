import { useState, useCallback } from "react";
import { t } from "../i18n";
import type {
  AppSettings,
  NpmAvailabilityResult,
  PiCliUpdateResult,
  PiInstallExecResult,
  PiInstallStatus,
  PiUpdateCheckResult,
} from "../../../shared/types";
import type { PiDesktopApi } from "../../../preload";

export interface UsePiUpdateOptions {
  piStatus: PiInstallStatus | null;
  setPiStatus: (status: PiInstallStatus | null) => void;
  piChecking: boolean;
  setPiChecking: (checking: boolean) => void;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  setEnvironmentDialog: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  showToast: (message: string, duration?: number) => void;
  api: PiDesktopApi;
}

export function usePiUpdate(options: UsePiUpdateOptions) {
  const {
    setPiStatus,
    setPiChecking,
    settings,
    setSettings,
    setEnvironmentDialog,
    setSettingsOpen,
    showToast,
    api,
  } = options;

  // ---- Pi 更新相关 state ----
  const [piUpdating, setPiUpdating] = useState(false);
  const [piUpdateChecking, setPiUpdateChecking] = useState(false);
  const [piUpdateCheck, setPiUpdateCheck] =
    useState<PiUpdateCheckResult | null>(null);
  const [piUpdateResult, setPiUpdateResult] =
    useState<PiCliUpdateResult | null>(null);

  // ---- Pi 代理相关 state ----
  const [piProxyNotice, setPiProxyNotice] = useState("");
  const [piProxyNoticeTone, setPiProxyNoticeTone] = useState<
    "info" | "success" | "error"
  >("info");
  const [piProxyChecking, setPiProxyChecking] = useState(false);

  // ---- 自定义 Pi 路径相关 state ----
  const [customPiPath, setCustomPiPath] = useState("");
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [customPathResult, setCustomPathResult] =
    useState<PiInstallStatus | null>(null);

  // ---- npm 安装相关 state ----
  const [npmAvailable, setNpmAvailable] = useState<boolean | null>(null);
  const [npmVersion, setNpmVersion] = useState<string | undefined>(undefined);
  const [npmChecking, setNpmChecking] = useState(false);
  const [installCommand, setInstallCommand] = useState(
    "npm install -g @earendil-works/pi-coding-agent",
  );
  const [installUseMirror, setInstallUseMirror] = useState(false);
  const [installExecuting, setInstallExecuting] = useState(false);
  const [installResult, setInstallResult] =
    useState<PiInstallExecResult | null>(null);
  const [installCompleted, setInstallCompleted] = useState(false);

  // ---- Pi 检测函数 ----
  const checkPiInstall = useCallback(
    async (source: "startup" | "manual" = "manual") => {
      setSettingsOpen(false);
      setPiChecking(true);
      setEnvironmentDialog(true);
      try {
        const next = await api.pi.check();
        setPiStatus(next);
        if (next.installed && source === "startup") {
          const saved = await api.settings.update({
            piEnvironmentChecked: true,
          });
          setSettings(saved);
          window.setTimeout(() => setEnvironmentDialog(false), 3000);
        }
        if (next.installed && source === "manual")
          window.setTimeout(() => setEnvironmentDialog(false), 3000);
      } finally {
        setPiChecking(false);
      }
    },
    [api, setPiStatus, setPiChecking, setSettings, setSettingsOpen, setEnvironmentDialog],
  );

  const checkPiInstallInline = useCallback(async () => {
    setPiChecking(true);
    setCustomPathResult(null);
    try {
      const next = await api.pi.check();
      setPiStatus(next);
      if (next.installed) {
        const saved = await api.settings.update({
          piEnvironmentChecked: true,
        });
        setSettings(saved);
        showToast(
          t("app.piCheckPassed", {
            value: next.command ?? next.version ?? "pi",
          }),
        );
      } else {
        setSettingsOpen(false);
        setEnvironmentDialog(true);
        setPiStatus(next);
      }
    } finally {
      setPiChecking(false);
    }
  }, [api, setPiStatus, setPiChecking, setSettings, setSettingsOpen, setEnvironmentDialog]);

  // ---- 自定义 Pi 路径 ----
  const validateCustomPiPath = useCallback(
    async (options: { closeDialogOnSuccess?: boolean } = {}) => {
      const path = customPiPath.trim();
      if (!path) return;
      setCustomPathValidating(true);
      setCustomPathResult(null);
      try {
        const result = await api.pi.checkCustom(path);
        setCustomPathResult(result);
        if (result.installed) {
          const updated = await api.settings.get();
          setSettings(updated);
          setCustomPiPath(updated.customPiPath ?? result.command ?? path);
          setPiStatus(result);
          showToast(
            t("app.piPathSaved", {
              path: result.command ?? updated.customPiPath ?? path,
            }),
          );
          if (options.closeDialogOnSuccess) {
            window.setTimeout(() => setEnvironmentDialog(false), 3000);
          }
        } else {
          showToast(
            t("app.piPathValidateFailed", {
              error: result.error ?? t("environment.unableToRun"),
            }),
          );
        }
      } finally {
        setCustomPathValidating(false);
      }
    },
    [customPiPath, api, setPiStatus, setSettings, setEnvironmentDialog],
  );

  const clearCustomPiPath = useCallback(async () => {
    const updated = await api.settings.update({ customPiPath: "" });
    setSettings(updated);
    setCustomPiPath("");
    setCustomPathResult(null);
    showToast(t("app.piPathCleared"));
    const status = await api.pi.check();
    setPiStatus(status);
  }, [api, setPiStatus, setSettings]);

  // ---- npm ----
  const checkNpm = useCallback(async () => {
    setNpmChecking(true);
    try {
      const result = await api.pi.checkNpm();
      setNpmAvailable(result.available);
      setNpmVersion(result.version);
    } finally {
      setNpmChecking(false);
    }
  }, [api]);

  const execInstallCommand = useCallback(async () => {
    const cmd = installCommand.trim();
    if (!cmd) return;
    setInstallExecuting(true);
    setInstallResult(null);
    setInstallCompleted(false);
    try {
      const result = await api.pi.execInstall(cmd);
      setInstallResult(result);
      if (result.success && result.exitCode === 0) {
        setInstallCompleted(true);
      }
    } finally {
      setInstallExecuting(false);
    }
  }, [installCommand, api]);

  // ---- Pi CLI 更新 ----
  const checkPiCliUpdateOnStartup = useCallback(async () => {
    if (settings.disableUpdateCheck) return;
    try {
      const result = await api.pi.checkUpdate();
      setPiUpdateCheck(result);
      if (result.hasUpdate) {
        const message = t("settings.piUpdateStartupNotice");
        showToast(message, 6500);
      }
    } catch {
      // 后台检查失败不打扰用户
    }
  }, [settings.disableUpdateCheck, api]);

  const checkPiCliUpdate = useCallback(async () => {
    if (settings.disableUpdateCheck) return;
    setPiUpdateChecking(true);
    try {
      const result = await api.pi.checkUpdate();
      setPiUpdateCheck(result);
      showToast(
        result.error
          ? t("settings.piUpdateFailed", { error: result.error })
          : result.hasUpdate
            ? t("settings.piUpdateAvailable")
            : t("settings.piUpdateChecked"),
      );
    } finally {
      setPiUpdateChecking(false);
    }
  }, [settings.disableUpdateCheck, api]);

  const updatePiCli = useCallback(async () => {
    setPiUpdating(true);
    setPiUpdateResult(null);
    try {
      const result = await api.pi.update();
      setPiUpdateResult(result);
      await checkPiInstallInline();
      setPiUpdateCheck(await api.pi.checkUpdate());
      showToast(
        result.updated
          ? t("settings.piUpdateDone")
          : t("settings.piUpdateChecked"),
      );
    } catch (error) {
      showToast(
        t("settings.piUpdateFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setPiUpdating(false);
    }
  }, [api, checkPiInstallInline]);

  // ---- Pi 代理测试 ----
  const testPiProxy = useCallback(async () => {
    setPiProxyChecking(true);
    setPiProxyNoticeTone("info");
    setPiProxyNotice(t("app.proxyChecking"));
    try {
      const result = await api.settings.testPiProxy();
      setPiProxyNoticeTone(result.success ? "success" : "error");
      setPiProxyNotice(
        result.success
          ? t("app.proxyAvailable", {
              message: result.message ?? t("app.proxyDefaultOk"),
              elapsed: result.elapsedMs,
            })
          : t("app.proxyCheckFailed", {
              error: result.error ?? t("app.proxyUnknownError"),
            }),
      );
    } catch (error) {
      setPiProxyNoticeTone("error");
      setPiProxyNotice(
        t("app.proxyCheckFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setPiProxyChecking(false);
    }
  }, [api]);

  return {
    // exposed state
    piUpdating,
    piUpdateChecking,
    piUpdateCheck,
    piUpdateResult,
    piProxyNotice,
    piProxyNoticeTone,
    piProxyChecking,
    customPiPath,
    customPathValidating,
    customPathResult,
    installCommand,
    installUseMirror,
    installExecuting,
    installCompleted,
    installResult,
    npmChecking,
    npmAvailable,
    npmVersion,
    // setters
    setCustomPiPath,
    setCustomPathValidating,
    setCustomPathResult,
    setInstallCommand,
    setInstallUseMirror,
    setInstallExecuting,
    setInstallResult,
    setInstallCompleted,
    setNpmAvailable,
    setNpmVersion,
    setNpmChecking,
    setPiProxyNotice,
    setPiProxyNoticeTone,
    setPiProxyChecking,
    setPiUpdating,
    setPiUpdateChecking,
    setPiUpdateCheck,
    setPiUpdateResult,
    // functions
    checkPiInstall,
    checkPiInstallInline,
    validateCustomPiPath,
    clearCustomPiPath,
    checkNpm,
    execInstallCommand,
    checkPiCliUpdateOnStartup,
    checkPiCliUpdate,
    updatePiCli,
    testPiProxy,
  };
}
