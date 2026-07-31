import { t } from "../../i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

/**
 * 更新结果弹窗（#115 U5）：外壳换 shadcn Modal（small），内部排版类保留。
 */
export function UpdateErrorModal(props: {
  message: string;
  releasesUrl: string;
  onClose: () => void;
  onOpenRelease: () => void;
}) {
  return (
    <Modal open onClose={props.onClose} title={t("update.checkFailedTitle")} size="small">
      <div className="update-body">
        <p className="update-version-line">
          {t("update.checkFailedDescription")}
        </p>
        <div className="update-error-detail">
          {t("update.errorInfo", { message: props.message })}
        </div>
        <p className="update-asset-line">
          {t("update.manualReleaseHint")}
          <br />
          <span>{props.releasesUrl}</span>
        </p>
      </div>
      <div className="update-actions">
        <Button variant="ghost" onClick={props.onClose}>{t("common.close")}</Button>
        <Button variant="primary" onClick={props.onOpenRelease}>
          {t("update.openReleasePage")}
        </Button>
      </div>
    </Modal>
  );
}

export function UpToDateModal(props: {
  version: string;
  releasesUrl: string;
  onClose: () => void;
  onOpenRelease: () => void;
}) {
  return (
    <Modal open onClose={props.onClose} title={t("update.upToDateTitle")} size="small">
      <div className="update-body">
        <p className="update-version-line">
          {t("update.upToDateMessage", { version: props.version })}
        </p>
      </div>
      <div className="update-actions">
        <Button variant="ghost" onClick={props.onClose}>{t("common.close")}</Button>
        <Button variant="secondary" onClick={props.onOpenRelease}>
          {t("update.openReleasePage")}
        </Button>
      </div>
    </Modal>
  );
}
