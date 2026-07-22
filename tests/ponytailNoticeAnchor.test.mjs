import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const header = readFileSync(
  "src/renderer/src/components/session/SessionHeader.tsx",
  "utf8",
);
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("通知锚定在新会话控件下方而不是全局 toast", () => {
  assert.match(app, /showNotice\(notifyRequest\.message/);
  assert.match(app, /notice=\{appNotice\?\.message\}/);

  const comboIndex = header.indexOf('className="session-combo"');
  const triggerIndex = header.indexOf('className="session-combo-trigger"');
  const noticeIndex = header.indexOf('className="app-notice"');
  assert.ok(triggerIndex > comboIndex, "new Session trigger must be inside the combo anchor");
  assert.ok(noticeIndex > triggerIndex, "notice must render below the anchored trigger");

  const notice = cssRule("\\.app-notice");
  assert.ok(notice, "通知样式必须存在");
  assert.match(notice, /position:\s*absolute;/);
  assert.match(notice, /top:\s*calc\(100% \+ 20px\);/);
  assert.match(notice, /right:\s*0;/);

  const combo = cssRule("\\.session-combo,\\n\\.file-action-combo");
  assert.ok(combo, "Session combo anchor styles must exist");
  assert.match(combo, /position:\s*relative;/);
});
