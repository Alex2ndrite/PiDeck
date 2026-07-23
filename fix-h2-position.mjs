// fix-h2-position.mjs — move useAppUpdate hook call after settings/appInfo declarations
import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/renderer/src/App.tsx";
let app = readFileSync(appPath, "utf8");

// Remove the hook call from its current position
const hookCall = `  // ===== App 更新 hook (H2) =====
  const appUpdate = useAppUpdate({ api, appInfo, settings, showToast });
  const { appUpdateController, upToDateVersion, updateChecking, checkAppUpdate } = appUpdate;
`;

app = app.replace(hookCall + "\n", "");
console.log("✓ Removed hook call from early position");

// Find the appInfo declaration and insert after its closing
const appInfoEnd = app.indexOf("const [appInfo, setAppInfo] = useState<AppInfo>({");
// Find the closing of this block (search for the next 'const' or 'let' declaration after it)
const afterAppInfo = app.indexOf("\n  const [piChecking", appInfoEnd);
if (afterAppInfo >= 0) {
  app = app.slice(0, afterAppInfo + 1) + "\n" + hookCall + app.slice(afterAppInfo + 1);
  console.log("✓ Inserted hook call after appInfo");
} else {
  console.log("✗ Could not find insertion point");
}

writeFileSync(appPath, app, "utf8");
console.log("Len:", app.length);
