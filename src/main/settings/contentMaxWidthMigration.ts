/**
 * contentMaxWidth 兼容迁移：旧版本该设置存「px 最大宽度」（800–1800，1800=不限，
 * 0 也代表不限），新版本改为「占会话面板宽度的百分比」（50–100，100=不限）。
 *
 * 转换规则：
 * - 0 或 1800 → 100（不限，语义等价）；
 * - 其余旧 px 值 → 按 /16 折算（对应约 1400px 宽面板上的占比）并夹到 [50, 100]，
 *   保证旧用户手动调过的宽度升级后仍然落在合理区间；
 * - 新语义值（1–100）原样保留。
 */
export function migrateContentMaxWidth(value: number): number {
  if (value > 100) {
    return Math.min(100, Math.max(50, Math.round(value / 16)));
  }
  // 0 是旧版「不限」哨兵值，统一归一为 100
  if (value === 0) return 100;
  return value;
}
