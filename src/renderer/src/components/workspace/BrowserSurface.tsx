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
      <BrowserPanel
        onClose={props.onClose}
        onToggleFullscreen={props.onEnterFullscreen}
      />
      {props.children}
    </div>
  );
}
