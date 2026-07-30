import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 约定的类名合并工具：clsx 处理条件类名，twMerge 消解 Tailwind
 * 冲突类（后者覆盖前者），组件封装时允许调用方用 className 覆盖默认样式。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
