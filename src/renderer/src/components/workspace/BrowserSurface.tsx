import type { ReactNode } from "react";
import { BrowserPanel } from "../app/BrowserPanel";

export type BrowserSurfaceProps = {
  fullscreen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onEnterFullscreen: () => void;
  className?: string;
  children?: ReactNode;
};

/** Provides one BrowserPanel owner while moving it between drawer and fullscreen compositor. */
export function BrowserSurface(props: BrowserSurfaceProps) {
  if (props.fullscreen) {
    return (
      <div className={props.className ?? "modal-backdrop"} onClick={props.onClose}>
        <div className="browser-modal" onClick={(event) => event.stopPropagation()}>
          <BrowserPanel
            isFullscreen
            onClose={props.onClose}
            onMinimize={props.onMinimize}
          />
          {props.children}
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-content-frame">
      {/* 抽屉模式下由 DrawerSurface 的统一 drawer-header 提供关闭，隐藏面板内部叉避免重复 */}
      <BrowserPanel
        hideChromeClose
        onClose={props.onClose}
        onToggleFullscreen={props.onEnterFullscreen}
      />
      {props.children}
    </div>
  );
}
