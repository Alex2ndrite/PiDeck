import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
const skills = readFileSync("src/renderer/src/config/SkillsTab.tsx", "utf8");
const prompts = readFileSync("src/renderer/src/config/PromptsTab.tsx", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
const skillCard = skills.slice(skills.indexOf("function SkillCard"));

test("config shell defines compact density and crisp system typography", () => {
  assert.match(surfaces, /\.config-modal \[data-slot="button"\]/);
  assert.match(surfaces, /\.config-modal \[data-slot="input"\]/);
  assert.match(surfaces, /-webkit-font-smoothing: antialiased/);
  assert.match(foundation, /Segoe UI Variable Text/);
  assert.match(foundation, /Microsoft YaHei UI/);
  assert.doesNotMatch(surfaces, /\.config-models-grid-header[\s\S]*font-weight: 650/);
  assert.match(configModal, /config-modal/);
});

test("skills and prompts use content-width secondary tabs", () => {
  assert.match(skills, /<TabsList className="w-fit"/);
  assert.match(prompts, /<TabsList className="w-fit"/);
  assert.doesNotMatch(skills, /<TabsList className="w-full"/);
  assert.doesNotMatch(prompts, /<TabsList className="w-full"/);
});

test("skill list is not accidentally filtered by the new-skill destination", () => {
  assert.match(skills, /const visibleSkills = data\.skills;/);
  assert.doesNotMatch(skills, /const filteredSkills = data\.skills\.filter/);
});

test("skill editing does not nest action buttons inside a clickable card button", () => {
  assert.match(skillCard, /skill-card-main/);
  assert.doesNotMatch(skillCard, /<button[\s\S]*skill-rename-inline[\s\S]*<Button/);
});
