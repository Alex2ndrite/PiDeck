import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
const skills = readFileSync("src/renderer/src/config/SkillsTab.tsx", "utf8");
const prompts = readFileSync("src/renderer/src/config/PromptsTab.tsx", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
const rendererStyles = readFileSync("src/renderer/src/styles.css", "utf8");
const settingsModal = readFileSync("src/renderer/src/components/app/SettingsModal.tsx", "utf8");
const tabs = readFileSync("src/renderer/src/components/ui-shadcn/tabs.tsx", "utf8");
const skillTableRow = skills.slice(skills.indexOf("function SkillTableRow"));

test("config shell defines compact density and crisp system typography", () => {
  assert.match(surfaces, /\.config-modal \[data-slot="button"\]/);
  assert.match(surfaces, /\.config-modal \[data-slot="input"\]/);
  // Windows/Electron 小字号中文需要保留子像素抗锯齿；config modal 不能强制 grayscale antialiasing。
  assert.match(surfaces, /\.config-modal \{[\s\S]*-webkit-font-smoothing: subpixel-antialiased/);
  assert.match(surfaces, /\.config-modal \{[\s\S]*text-rendering: auto/);
  assert.doesNotMatch(surfaces, /\.config-modal \{[\s\S]*-webkit-font-smoothing: antialiased;/);
  assert.match(surfaces, /\.config-nav-btn \{[\s\S]*font-size:\s*14px/);
  // 选中态随 Vertical Tabs 迁移：由 TabsTrigger data-[state=active] utility 承担
  assert.match(tabs, /data-\[state=active\]:bg-bg-panel/);
  assert.doesNotMatch(surfaces, /\.config-nav-btn\.active \{/);
  assert.match(foundation, /Segoe UI Variable Text/);
  assert.match(foundation, /Microsoft YaHei UI/);
  assert.doesNotMatch(foundation, /MiSans/);
  assert.match(settingsModal, /value: "system"/);
  assert.doesNotMatch(rendererStyles, /styles\/lxgw-wenkai\.css/);
  assert.doesNotMatch(rendererStyles, /misans/i);
  assert.equal(existsSync("src/renderer/assets/fonts/misans"), false);
  assert.equal(existsSync("src/renderer/src/styles/misans"), false);
  assert.equal(existsSync("src/renderer/assets/fonts/lxgw-wenkai"), false);
  assert.equal(existsSync("src/renderer/src/styles/lxgw-wenkai.css"), false);
  assert.doesNotMatch(rendererStyles, /lxgw-wenkai/);
  assert.doesNotMatch(surfaces, /\.config-models-grid-header[\s\S]*font-weight: 650/);
  assert.match(configModal, /configModalSizeClass/);
  assert.match(configModal, /w-\[80vw\]/);
  assert.match(configModal, /max-w-\[80vw\]/);
  assert.match(configModal, /h-\[80vh\]/);
  assert.match(configModal, /sm:max-w-\[min\(1300px,80vw\)\]/);
  assert.match(configModal, /max-\[820px\]:flex-col/);
  assert.match(configModal, /max-\[820px\]:flex-row/);
  assert.match(settingsModal, /settingsModalSizeClass/);
  assert.match(settingsModal, /w-\[80vw\]/);
  assert.match(surfaces, /\.settings-modal \{[\s\S]*width: min\(1300px, 80vw\);[\s\S]*height: min\(850px, 80vh\);/);
  assert.match(surfaces, /\.config-modal \{[\s\S]*width: min\(1300px, 80vw\);[\s\S]*height: min\(850px, 80vh\);/);
});

test("skills and prompts use full-width tab rails with compact selected tabs", () => {
  assert.match(skills, /<TabsList className="w-full"/);
  assert.match(prompts, /<TabsList className="w-full"/);
  const tabs = readFileSync("src/renderer/src/components/ui-shadcn/tabs.tsx", "utf8");
  assert.match(tabs, /w-full items-center/);
  assert.match(tabs, /data-\[state=active\]:shadow-sm/);
  assert.match(tabs, /!text-\[color:var\(--color-text-secondary\)\]/);
});

test("skill list is not accidentally filtered by the new-skill destination", () => {
  assert.match(skills, /const visibleSkills = data\.skills;/);
  assert.doesNotMatch(skills, /const filteredSkills = data\.skills\.filter/);
});

test("skill table uses real aligned columns, not a colSpan card", () => {
  assert.match(skillTableRow, /<TableRow>/);
  assert.match(skillTableRow, /<TableCell className="min-w-0">/);
  assert.match(skillTableRow, /<TableCell className="whitespace-normal break-words/);
  assert.match(skillTableRow, /<TableCell className="text-right">/);
  // 操作按钮直接放在 TableCell 内，不再包一层可点击的卡片 button。
  assert.doesNotMatch(skillTableRow, /<button[\s\S]*skill-rename-inline[\s\S]*<Button/);
  // 位置选择改为 shadcn Select，不再使用自定义下拉弹层。
  assert.match(skills, /<SelectTrigger className="w-full">/);
  assert.doesNotMatch(skills, /skill-location-picker/);
});
