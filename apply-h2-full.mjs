// apply-h2-full.mjs — add import and hook call for useAppUpdate, remove old code
import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/renderer/src/App.tsx";
let app = readFileSync(appPath, "utf8");
console.log("Len before:", app.length);

// 1. Add import after usePiUpdate
app = app.replace(
  'import { usePiUpdate } from "./hooks/usePiUpdate";',
  'import { usePiUpdate } from "./hooks/usePiUpdate";\nimport { useAppUpdate } from "./hooks/useAppUpdate";'
);
console.log("✓ Added import");

// 2. Replace state declarations + appUpdateController with hook call
const oldBlock = `  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const [downloadedUpdatePath, setDownloadedUpdatePath] = useState<string | null>(null);
  const [upToDateVersion, setUpToDateVersion] = useState<string | null>(null);
  const appUpdateController = useMemo(() => ({
    info: updateInfo,
    error: updateError,
    checking: updateChecking,
    downloading: updateDownloading,
    progress: updateProgress,
    downloadedPath: downloadedUpdatePath,
    download: async () => { await downloadAppUpdate(); return downloadedUpdatePath; },
    install: async () => { if (downloadedUpdatePath) await api.app.installUpdate(downloadedUpdatePath); },
    clear: () => { setUpdateInfo(null); setUpdateError(null); setUpdateProgress(null); setDownloadedUpdatePath(null); setUpToDateVersion(null); },
    check: undefined as unknown as (source?: "auto" | "manual") => Promise<AppUpdateInfo | null>,
  }), [updateInfo, updateError, updateChecking, updateDownloading, updateProgress, downloadedUpdatePath]);`;

const newBlock = `  // ===== App 更新 hook (H2) =====
  const appUpdate = useAppUpdate({ api, appInfo, settings, showToast });
  const { appUpdateController, upToDateVersion, updateChecking, checkAppUpdate } = appUpdate;`;

if (app.includes(oldBlock)) {
  app = app.replace(oldBlock, newBlock);
  console.log("✓ Replaced state + controller with hook call");
} else {
  console.log("✗ Old block not found");
}

// 3. Remove function definitions (downloadAppUpdate through checkAppUpdate)
const downloadIdx = app.indexOf("  async function downloadAppUpdate() {");
const refreshIdx = app.indexOf("  async function refreshProjects() {");
if (downloadIdx >= 0 && refreshIdx > downloadIdx) {
  app = app.slice(0, downloadIdx) + app.slice(refreshIdx);
  console.log("✓ Removed old function definitions");
} else {
  console.log("✗ Functions not found:", downloadIdx, refreshIdx);
}

writeFileSync(appPath, app, "utf8");
console.log("Len after:", app.length);
