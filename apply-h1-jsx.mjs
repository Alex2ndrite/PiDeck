// apply-h1-jsx.mjs — update JSX references in App.tsx
import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/renderer/src/App.tsx";
let app = readFileSync(appPath, "utf8");

// Replace EnvironmentDialog onClose and onRecheck callbacks
app = app.replace(
  `          onClose={() => {
            setEnvironmentDialog(false);
            setCustomPathResult(null);
            // 关闭时重置安装状态
            setInstallResult(null);
            setInstallCompleted(false);
            setNpmAvailable(null);
          }}
          onRecheck={() => {
            setCustomPathResult(null);
            setNpmAvailable(null);
            setNpmVersion(undefined);
            setInstallResult(null);
            setInstallCompleted(false);
            setInstallUseMirror(false);
            checkPiInstall("manual");
          }}`,
  `          onClose={() => {
            setEnvironmentDialog(false);
            piUpdate.setCustomPathResult(null);
            // 关闭时重置安装状态
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
            piUpdate.setNpmAvailable(null);
          }}
          onRecheck={() => {
            piUpdate.setCustomPathResult(null);
            piUpdate.setNpmAvailable(null);
            piUpdate.setNpmVersion(undefined);
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
            piUpdate.setInstallUseMirror(false);
            piUpdate.checkPiInstall("manual");
          }}`
);
console.log("✓ Updated EnvironmentDialog onClose/onRecheck");

// Replace EnvironmentDialog props (customPath through onExecInstall)
const envDialogOld = `          customPath={customPiPath}
          customPathValidating={customPathValidating}
          customPathResult={customPathResult}
          onCustomPathChange={(path) => {
            setCustomPiPath(path);
            setCustomPathResult(null);
          }}
          onValidateCustomPath={() =>
            validateCustomPiPath({ closeDialogOnSuccess: true })
          }
          npmAvailable={npmAvailable}
          npmVersion={npmVersion}
          npmChecking={npmChecking}
          installCommand={installCommand}
          installUseMirror={installUseMirror}
          installExecuting={installExecuting}
          installResult={installResult}
          installCompleted={installCompleted}
          onCheckNpm={checkNpm}
          onInstallCommandChange={(cmd) => {
            setInstallCommand(cmd);
            setInstallResult(null);
            setInstallCompleted(false);
          }}
          onToggleInstallMirror={() => {
            setInstallUseMirror((prev) => {
              // 切换镜像，同时更新命令文本
              if (prev) {
                // 移除镜像
                setInstallCommand((cmd) =>
                  cmd.replace(
                    /\\s+--registry=https:\\/\\/registry\\.npmmirror\\.com/g,
                    "",
                  ),
                );
              } else {
                // 添加镜像
                setInstallCommand((cmd) =>
                  cmd.includes("--registry=")
                    ? cmd
                    : cmd + " --registry=https://registry.npmmirror.com",
                );
              }
              return !prev;
            });
            setInstallResult(null);
            setInstallCompleted(false);
          }}
          onExecInstall={execInstallCommand}`;

const envDialogNew = `          customPath={piUpdate.customPiPath}
          customPathValidating={piUpdate.customPathValidating}
          customPathResult={piUpdate.customPathResult}
          onCustomPathChange={(path) => {
            piUpdate.setCustomPiPath(path);
            piUpdate.setCustomPathResult(null);
          }}
          onValidateCustomPath={() =>
            piUpdate.validateCustomPiPath({ closeDialogOnSuccess: true })
          }
          npmAvailable={piUpdate.npmAvailable}
          npmVersion={piUpdate.npmVersion}
          npmChecking={piUpdate.npmChecking}
          installCommand={piUpdate.installCommand}
          installUseMirror={piUpdate.installUseMirror}
          installExecuting={piUpdate.installExecuting}
          installResult={piUpdate.installResult}
          installCompleted={piUpdate.installCompleted}
          onCheckNpm={piUpdate.checkNpm}
          onInstallCommandChange={(cmd) => {
            piUpdate.setInstallCommand(cmd);
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
          }}
          onToggleInstallMirror={() => {
            piUpdate.setInstallUseMirror((prev) => {
              if (prev) {
                piUpdate.setInstallCommand((cmd) =>
                  cmd.replace(
                    /\\s+--registry=https:\\/\\/registry\\.npmmirror\\.com/g,
                    "",
                  ),
                );
              } else {
                piUpdate.setInstallCommand((cmd) =>
                  cmd.includes("--registry=")
                    ? cmd
                    : cmd + " --registry=https://registry.npmmirror.com",
                );
              }
              return !prev;
            });
            piUpdate.setInstallResult(null);
            piUpdate.setInstallCompleted(false);
          }}
          onExecInstall={piUpdate.execInstallCommand}`;

if (app.includes(envDialogOld)) {
  app = app.replace(envDialogOld, envDialogNew);
  console.log("✓ Updated EnvironmentDialog props");
} else {
  console.log("✗ EnvironmentDialog props not found (may already be updated)");
}

// Replace SettingsModal props
const settingsOld = `          piProxyChecking={piProxyChecking}
          piProxyNotice={piProxyNotice}
          piProxyNoticeTone={piProxyNoticeTone}
          webServiceChanging={webServiceChanging}
          appInfo={appInfo}
          customPiPath={customPiPath}
          customPathValidating={customPathValidating}
          customPathResult={customPathResult}
          updateChecking={updateChecking}
          piUpdating={piUpdating}
          piUpdateChecking={piUpdateChecking}
          piUpdateCheck={piUpdateCheck}
          piUpdateResult={piUpdateResult}
          onCustomPathChange={(path) => {
            setCustomPiPath(path);
            setCustomPathResult(null);
          }}
          onValidateCustomPath={() => validateCustomPiPath()}
          onClearCustomPath={clearCustomPiPath}
          onCheckPi={checkPiInstallInline}
          onTestPiProxy={() => testPiProxy()}
          onCheckUpdate={() => checkAppUpdate("manual")}
          onCheckPiUpdate={checkPiCliUpdate}
          onUpdatePi={updatePiCli}`;

const settingsNew = `          piProxyChecking={piUpdate.piProxyChecking}
          piProxyNotice={piUpdate.piProxyNotice}
          piProxyNoticeTone={piUpdate.piProxyNoticeTone}
          webServiceChanging={webServiceChanging}
          appInfo={appInfo}
          customPiPath={piUpdate.customPiPath}
          customPathValidating={piUpdate.customPathValidating}
          customPathResult={piUpdate.customPathResult}
          updateChecking={updateChecking}
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
          onCheckUpdate={() => checkAppUpdate("manual")}
          onCheckPiUpdate={piUpdate.checkPiCliUpdate}
          onUpdatePi={piUpdate.updatePiCli}`;

if (app.includes(settingsOld)) {
  app = app.replace(settingsOld, settingsNew);
  console.log("✓ Updated SettingsModal props");
} else {
  console.log("✗ SettingsModal props not found (may already be updated)");
}

// Replace updateSettings handler
app = app.replace(
  `        setPiProxyNoticeTone("info");
        setPiProxyNotice(next.piProxyEnabled ? t("app.shellProxySaved") : "");`,
  `        piUpdate.setPiProxyNoticeTone("info");
        piUpdate.setPiProxyNotice(next.piProxyEnabled ? t("app.shellProxySaved") : "");`
);
console.log("✓ Updated updateSettings handler");

writeFileSync(appPath, app, "utf8");
console.log("Done.");
