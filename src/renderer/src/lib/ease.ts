// Shared motion curves for source-distributed beUI components.
// Keeping these values in one module avoids each copied component inventing a different motion language.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};
