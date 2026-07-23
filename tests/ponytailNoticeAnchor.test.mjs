import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const sessionAtoms = readFileSync("src/renderer/src/atoms/session-atoms.ts", "utf8");
const header = readFileSync(
  "src/renderer/src/components/session/SessionHeader.tsx",
  "utf8",
);
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("通知锚定在新会话控件下方而不是全局 toast", () => {
  assert.match(sessionAtoms, /request\.method === "notify"/);
  assert.match(sessionAtoms, /notification:\s*\{/);
  assert.match(app, /showNotice\(\s*notification\.message/);
  assert.match(app, /<NoticeCenter \/>/);

  const noticeIndex = app.indexOf("<NoticeCenter");
  const comboInAppIndex = app.indexOf('className="session-combo"');
  assert.ok(noticeIndex > 0, "NoticeCenter must render in App");
  assert.ok(noticeIndex > comboInAppIndex, "NoticeCenter must render after session combo in App");

  const notice = cssRule("\\.app-notice");
  assert.ok(notice, "通知样式必须存在");
  assert.match(notice, /position:\s*absolute;/);
  assert.match(notice, /top:\s*calc\(100% \+ 20px\);/);
  assert.match(notice, /right:\s*0;/);

  const combo = cssRule("\\.session-combo,\\n\\.file-action-combo");
  assert.ok(combo, "Session combo anchor styles must exist");
  assert.match(combo, /position:\s*relative;/);
});
