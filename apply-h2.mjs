// apply-h2.mjs — remove app update functions from App.tsx
import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/renderer/src/App.tsx";
let app = readFileSync(appPath, "utf8");
console.log("Len before:", app.length);

// Remove downloadAppUpdate through checkAppUpdate (before refreshProjects)
const downloadIdx = app.indexOf("  async function downloadAppUpdate() {");
const refreshIdx = app.indexOf("  async function refreshProjects() {");
if (downloadIdx >= 0 && refreshIdx > downloadIdx) {
  app = app.slice(0, downloadIdx) + app.slice(refreshIdx);
  console.log("Removed downloadAppUpdate through checkAppUpdate");
} else {
  console.log("Not found:", downloadIdx, refreshIdx);
}

writeFileSync(appPath, app, "utf8");
console.log("Len after:", app.length);
