import { lazy, Suspense } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { AppInfo, AppSettings } from "../../../../shared/types";
import { settingsOpenAtom } from "../../atoms";
import { desktopApi as api } from "../../desktopApi";
import type { AppUpdateControllerState } from "../../hooks/useAppUpdateController";
import type { PiUpdateController } from "../../hooks/usePiUpdate";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";

const SettingsModal = lazy(() =>
  import("./SettingsModal").then((module) => ({ default: module.SettingsModal })),
);

type SettingsFeatureRootProps = {
  settings: AppSettings;
  piUpdate: PiUpdateController;
  appUpdate: Pick<AppUpdateControllerState, "checking" | "error" | "check">;
  webServiceChanging: boolean;
  appInfo: AppInfo;
  onChange: (patch: Partial<AppSettings>) => void | Promise<void>;
  onCurrentVersion: (version: string) => void;
};

/** Owns Settings overlay visibility and modal-only commands without mirroring AppSettings. */
export function SettingsFeatureRoot(props: SettingsFeatureRootProps) {
  const open = useAtomValue(settingsOpenAtom);
  const setOpen = useSetAtom(settingsOpenAtom);

  if (!open) return null;

  const { appInfo, appUpdate, piUpdate, settings, webServiceChanging } = props;
  return (
    <Suspense fallback={null}>
      <SettingsModal
        settings={settings}
        piStatus={piUpdate.piStatus}
        piChecking={piUpdate.piChecking}
        piProxyChecking={piUpdate.piProxyChecking}
        piProxyNotice={piUpdate.piProxyNotice}
        piProxyNoticeTone={piUpdate.piProxyNoticeTone}
        webServiceChanging={webServiceChanging}
        appInfo={appInfo}
        customPiPath={piUpdate.customPiPath}
        customPathValidating={piUpdate.customPathValidating}
        customPathResult={piUpdate.customPathResult}
        updateChecking={appUpdate.checking}
        piUpdating={piUpdate.piUpdating}
        piUpdateChecking={piUpdate.piUpdateChecking}
        piUpdateCheck={piUpdate.piUpdateCheck}
        piUpdateResult={piUpdate.piUpdateResult}
        onCustomPathChange={(path) => {
          piUpdate.setCustomPiPath(path);
          piUpdate.setCustomPathResult(null);
        }}
        onValidateCustomPath={() => piUpdate.validateCustomPiPath()}
        onClearCustomPath={piUpdate.clearCustomPiPath}
        onCheckPi={piUpdate.checkPiInstallInline}
        onTestPiProxy={() => piUpdate.testPiProxy()}
        onCheckUpdate={() => {
          void appUpdate.check("manual").then((info) => {
            if (info && !info.hasUpdate) {
              props.onCurrentVersion(info.currentVersion);
              showNotice(t("app.latestVersionNotice", { version: info.currentVersion }));
            } else if (!info && appUpdate.error) {
              showNotice(t("app.updateFailedNotice", { error: appUpdate.error }));
            }
          });
        }}
        onCheckPiUpdate={piUpdate.checkPiCliUpdate}
        onUpdatePi={piUpdate.updatePiCli}
        onToggleDevTools={async () => {
          const opened = await api.app.toggleDevTools();
          showNotice(opened ? t("app.devToolsOpened") : t("app.devToolsClosed"));
        }}
        onRestartApp={() => api.app.restart()}
        onClearCheckFlag={async () => {
          await api.settings.update({ piEnvironmentChecked: false });
          showNotice(t("environment.checkFlagCleared"));
        }}
        onOpenWebService={(port) => api.app.openExternal(`http://127.0.0.1:${port}`, true)}
        onClose={() => setOpen(false)}
        onChange={props.onChange}
      />
    </Suspense>
  );
}
