export function cn(...inputs: Array<string | false | null | undefined | 0>) {
  return inputs.filter(Boolean).join(" ");
}
