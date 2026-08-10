import assert from "node:assert/strict";
import test from "node:test";
import { migrateContentMaxWidth } from "../src/main/settings/contentMaxWidthMigration.ts";

/**
 * contentMaxWidth 兼容迁移：旧版本存 px（800–1800，1800=不限，0=不限），
 * 新版本存占会话面板的百分比（50–100，100=不限）。
 * 迁移必须保证旧用户升级后宽度仍落在合理区间，且新语义值不被改动。
 */
test("旧默认 1800px（不限）迁移为 100（不限）", () => {
  assert.equal(migrateContentMaxWidth(1800), 100);
});

test("旧哨兵值 0（不限）迁移为 100", () => {
  assert.equal(migrateContentMaxWidth(0), 100);
});

test("旧 px 值按 /16 折算并夹到 [50, 100]", () => {
  // 800px ≈ 50%；1400px ≈ 88%；1600px → 100（不限）
  assert.equal(migrateContentMaxWidth(800), 50);
  assert.equal(migrateContentMaxWidth(1400), 88);
  assert.equal(migrateContentMaxWidth(1600), 100);
  // 极端小值也不低于 50
  assert.equal(migrateContentMaxWidth(50), 50);
});

test("新百分比语义值（1–100）原样保留", () => {
  assert.equal(migrateContentMaxWidth(100), 100);
  assert.equal(migrateContentMaxWidth(75), 75);
  assert.equal(migrateContentMaxWidth(50), 50);
  assert.equal(migrateContentMaxWidth(1), 1);
});
