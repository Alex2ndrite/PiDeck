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
const skillCard = skills.slice(skills.indexOf("function SkillCard"));

test("config shell defines compact density and crisp system typography", () => {
  assert.match(surfaces, /\.config-modal \[data-slot="button"\]/);
  assert.match(surfaces, /\.config-modal \[data-slot="input"\]/);
  // Windows/Electron 小字号中文需要保留子像素抗锯齿；config modal 不能强制 grayscale antialiasing。
  assert.match(surfaces, /\.config-modal \{[\s\S]*-webkit-font-smoothing: subpixel-antialiased/);
  assert.match(surfaces, /\.config-modal \{[\s\S]*text-rendering: auto/);
  assert.doesNotMatch(surfaces, /\.config-modal \{[\s\S]*-webkit-font-smoothing: antialiased;/);
  assert.match(surfaces, /\.config-nav-btn \{[\s\S]*font-size:\s*14px/);
  assert.match(surfaces, /\.config-nav-btn\.active \{[\s\S]*font-weight:\s*500/);
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
  assert.match(configModal, /config-modal/);
});

test("skills and prompts use compact visible tab lists", () => {
  assert.match(skills, /<TabsList className="w-fit"/);
  assert.match(prompts, /<TabsList className="w-fit"/);
  assert.match(readFileSync("src/renderer/src/components/ui-shadcn/tabs.tsx", "utf8"), /w-fit items-center/);
  assert.match(readFileSync("src/renderer/src/components/ui-shadcn/tabs.tsx", "utf8"), /!text-\[color:var\(--color-text-secondary\)\]/);
});

test("skill list is not accidentally filtered by the new-skill destination", () => {
  assert.match(skills, /const visibleSkills = data\.skills;/);
  assert.doesNotMatch(skills, /const filteredSkills = data\.skills\.filter/);
});

test("skill editing does not nest action buttons inside a clickable card button", () => {
  assert.match(skillCard, /skill-card-main/);
  assert.doesNotMatch(skillCard, /<button[\s\S]*skill-rename-inline[\s\S]*<Button/);
});
