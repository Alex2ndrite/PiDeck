// Shared motion curves for source-distributed beUI components.
// Keeping these values in one module avoids each copied component inventing a different motion language.
//
// 与 beui.dev 官方 registry 的 lib/ease.ts 的差异：
// - EASE_OUT / SPRING_LAYOUT 沿用本仓库既有基线值（preview-rail 等早期迁移组件已在使用），
//   不随 todo-list 迁移改值，避免同一视觉语言被拆成两套；
// - 其余常量（EASE_OUT_CSS / SPRING_PRESS / SPRING_SWAP）按官方值补齐，供
//   agents/todo-list 与 motion/action-swap 使用。
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Symmetric ease for loaders and looping grid pulses (beUI official value). */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions（与上方 EASE_OUT 数值保持一致）。 */
export const EASE_OUT_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
  mass: 0.6,
};

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  type: "spring" as const,
  stiffness: 460,
  damping: 30,
  mass: 0.55,
};

export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};
