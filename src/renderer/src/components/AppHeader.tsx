import { useState } from "react";
import { Pin, Minus, Square, X } from "lucide-react";
import { t } from "../i18n";

type Props = {
  useNativeTitleBar: boolean;
  toggleAlwaysOnTop: () => Promise<boolean>;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
};

export function AppHeader({ useNativeTitleBar, toggleAlwaysOnTop, minimizeWindow, toggleMaximizeWindow, closeWindow }: Props) {
  const [windowAlwaysOnTop, setWindowAlwaysOnTop] = useState(false);

  if (useNativeTitleBar) return null;

  return (
    <>
      <div className="window-drag-layer" aria-hidden="true" />
      <div className="window-controls" aria-label={t("app.windowControls")}>
        <button
          type="button"
          className={`window-control pin${windowAlwaysOnTop ? " active" : ""}`}
          aria-label={windowAlwaysOnTop ? t("app.windowUnpin") : t("app.windowPin")}
          title={windowAlwaysOnTop ? t("app.windowUnpin") : t("app.windowPin")}
          onClick={async () => {
            const next = await toggleAlwaysOnTop();
            setWindowAlwaysOnTop(next);
          }}
        >
          <Pin size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button type="button" className="window-control" aria-label={t("app.windowMinimize")} title={t("app.windowMinimize")} onClick={() => minimizeWindow()}>
          <Minus size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button type="button" className="window-control" aria-label={t("app.windowToggleMaximize")} title={t("app.windowToggleMaximize")} onClick={() => toggleMaximizeWindow()}>
          <Square size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="window-control close" aria-label={t("app.windowClose")} title={t("app.windowClose")} onClick={() => closeWindow()}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
