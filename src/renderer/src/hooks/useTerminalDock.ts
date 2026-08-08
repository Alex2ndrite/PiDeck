import { useEffect, useRef, useState } from "react";
import {
  type TerminalDockOwner,
  type TerminalDockStateByOwner,
  setTerminalDockOpen,
  setTerminalDockCollapsed,
  pruneTerminalDockState,
  terminalOwnerKey,
} from "../terminalDockState";

const COMPOSER_DEFAULT_TERMINAL_HEIGHT = 220;
const TERMINAL_DOCK_MOTION_MS = 180;

/**
 * 终端 Dock 状态机（open / collapsed / 挂载动画 / 高度）按 owner 隔离：
 * - 有 activeAgent → agent owner（`agent:<id>`）
 * - 引导页 / 未激活 agent / 历史会话 → project owner（`project:<id>`）
 * 切换项目或 agent 时，各 owner 的开关、折叠、高度互不串台；
 * 挂载的 Dock 组件也只对「当前 owner」可见，切走即卸载（保留主进程 PTY 与回放）。
 */
export function useTerminalDock(activeOwner: TerminalDockOwner | undefined) {
  const [terminalDockStateByOwner, setTerminalDockStateByOwner] =
    useState<TerminalDockStateByOwner>({});
  const [terminalHeightByOwner, setTerminalHeightByOwner] = useState<
    Record<string, number>
  >({});
  const [terminalDockMounted, setTerminalDockMounted] = useState(false);
  const [terminalDockClosing, setTerminalDockClosing] = useState(false);
  const [terminalDockOwnerKey, setTerminalDockOwnerKey] = useState<string>();
  const terminalDockCloseTimerRef = useRef<number | null>(null);

  const activeOwnerKey = activeOwner
    ? terminalOwnerKey(activeOwner)
    : undefined;
  // 兼容旧数据：早期版本曾把裸 agentId 当 key 写入，读取时原地兜底
  const terminalDockState = activeOwnerKey
    ? terminalDockStateByOwner[activeOwnerKey] ??
      terminalDockStateByOwner[activeOwner?.id ?? ""]
    : undefined;
  const terminalOpen = Boolean(terminalDockState?.open);
  const terminalCollapsed = Boolean(terminalDockState?.collapsed);
  const terminalDockVisible =
    terminalDockMounted && terminalDockOwnerKey === activeOwnerKey;
  const terminalRowHeight = activeOwnerKey
    ? (terminalHeightByOwner[activeOwnerKey] ?? COMPOSER_DEFAULT_TERMINAL_HEIGHT)
    : COMPOSER_DEFAULT_TERMINAL_HEIGHT;

  // 轨道尺寸只在开关时变更一次，终端本身用 transform 完成合成动画。
  // 关闭时保留组件至动画结束，避免同步销毁 xterm 阻塞第一帧。
  // 切换 owner 时若新 owner 未打开，立即卸载，不把旧 owner 的关闭动画带到新上下文。
  useEffect(() => {
    if (terminalOpen && activeOwnerKey) {
      if (terminalDockCloseTimerRef.current != null) {
        window.clearTimeout(terminalDockCloseTimerRef.current);
        terminalDockCloseTimerRef.current = null;
      }
      setTerminalDockOwnerKey(activeOwnerKey);
      setTerminalDockClosing(false);
      setTerminalDockMounted(true);
      return;
    }
    if (!terminalDockMounted) return;
    if (terminalDockOwnerKey !== activeOwnerKey) {
      setTerminalDockMounted(false);
      return;
    }

    setTerminalDockClosing(true);
    terminalDockCloseTimerRef.current = window.setTimeout(
      () => {
        setTerminalDockMounted(false);
        setTerminalDockClosing(false);
      },
      TERMINAL_DOCK_MOTION_MS,
    );
    return () => {
      if (terminalDockCloseTimerRef.current != null) {
        window.clearTimeout(terminalDockCloseTimerRef.current);
        terminalDockCloseTimerRef.current = null;
      }
    };
  }, [activeOwnerKey, terminalDockOwnerKey, terminalDockMounted, terminalOpen]);

  /** 开关当前 owner 的终端（无 owner 时静默忽略，避免写坏 key） */
  function setTerminalOpenForOwner(open: boolean) {
    if (!activeOwnerKey) return;
    setTerminalDockStateByOwner((current) =>
      setTerminalDockOpen(current, activeOwnerKey, open),
    );
  }

  /** 折叠/展开当前 owner 的终端 */
  function setTerminalCollapsedForOwner(collapsed: boolean) {
    if (!activeOwnerKey) return;
    setTerminalDockStateByOwner((current) =>
      setTerminalDockCollapsed(current, activeOwnerKey, collapsed),
    );
  }

  /** 按 owner key 更新终端高度（拖拽回写） */
  function updateTerminalHeightByOwner(
    updater: (current: Record<string, number>) => Record<string, number>,
  ) {
    setTerminalHeightByOwner(updater);
  }

  /**
   * 清理已消失 owner 的终端状态：agent 键对照存活 agent 集合，project 键对照
   * 存活项目集合，两个集合互不误删（流式事件只更新 agent 集合时不能清掉项目终端）。
   */
  function prune(liveAgentIds: Set<string>, liveProjectIds: Set<string>) {
    setTerminalDockStateByOwner((current) =>
      pruneTerminalDockState(current, liveAgentIds, liveProjectIds),
    );
    setTerminalHeightByOwner((current) => {
      const liveEntries = Object.entries(current).filter(([key]) => {
        // 高度键为 agent:<id> / project:<id>，按各自存活集合过滤，互不误删
        if (key.startsWith("agent:")) return liveAgentIds.has(key.slice(6));
        if (key.startsWith("project:")) return liveProjectIds.has(key.slice(8));
        return false;
      });
      return liveEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(liveEntries);
    });
  }

  return {
    terminalOpen,
    terminalCollapsed,
    terminalDockVisible,
    terminalDockClosing,
    terminalRowHeight,
    setTerminalOpenForOwner,
    setTerminalCollapsedForOwner,
    setTerminalHeightByOwner: updateTerminalHeightByOwner,
    terminalDockMounted,
    terminalDockOwnerKey,
    prune,
  };
}
