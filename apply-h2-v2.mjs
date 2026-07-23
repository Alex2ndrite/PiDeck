// apply-h2-v2.mjs — complete H2 migration in App.tsx
import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/renderer/src/App.tsx";
let app = readFileSync(appPath, "utf8");
console.log("Len before:", app.length);

// Step 1: Add import after usePiUpdate
app = app.replace(
  'import { usePiUpdate } from "./hooks/usePiUpdate";',
  'import { usePiUpdate } from "./hooks/usePiUpdate";\nimport { useAppUpdate } from "./hooks/useAppUpdate";'
);

// Step 2: Remove old state + appUpdateController block
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

if (!app.includes(oldBlock)) {
  console.log("ERROR: old block not found");
  process.exit(1);
}
app = app.replace(oldBlock, "");

// Step 3: Remove old function definitions
const dlIdx = app.indexOf("  async function downloadAppUpdate() {");
const refreshIdx = app.indexOf("  async function refreshProjects() {");
if (dlIdx < 0 || refreshIdx <= dlIdx) {
  console.log("ERROR: functions not found", dlIdx, refreshIdx);
  process.exit(1);
}
app = app.slice(0, dlIdx) + app.slice(refreshIdx);

// Step 4: Insert hook call after appInfo declaration
// Find the line immediately after appInfo useState closes
const appInfoPattern = /(const \[appInfo, setAppInfo\] = useState<AppInfo>\(\{[\s\S]*?\}\);\n)/;
const match = app.match(appInfoPattern);
if (!match) {
  console.log("ERROR: appInfo declaration not found");
  process.exit(1);
}
const insertPos = match.index + match[0].length;
const hookCall = `\n  // ===== App 更新 hook (H2) =====
  const appUpdate = useAppUpdate({ api, appInfo, settings, showToast });
  const { appUpdateController, upToDateVersion, updateChecking, checkAppUpdate } = appUpdate;\n`;
app = app.slice(0, insertPos) + hookCall + app.slice(insertPos);

writeFileSync(appPath, app, "utf8");
console.log("Len after:", app.length);
console.log("Done.");
