import { X } from "lucide-react";
import { t } from "../i18n";

type FileRenameProps = {
  path: string;
  name: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onConfirm: (path: string, newName: string) => void;
};

type AgentRenameProps = {
  isAgent: boolean;
  value: string;
  saving: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

type Props = {
  fileRename?: FileRenameProps;
  agentRename?: AgentRenameProps;
};

export function RenameModals({ fileRename, agentRename }: Props) {
  return <>
    {agentRename && (
      <div className="modal-backdrop rename-dialog-backdrop" onClick={() => { if (!agentRename.saving) agentRename.onClose(); }}>
        <form className="rename-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); agentRename.onSubmit(); }}>
          <div className="rename-dialog-header">
            <strong>{t("app.renameSessionTitle")}</strong>
            <button type="button" disabled={agentRename.saving} onClick={agentRename.onClose}><X size={15} /></button>
          </div>
          <input autoFocus value={agentRename.value} onChange={(e) => agentRename.onValueChange(e.target.value)} placeholder={t("app.renameSessionPlaceholder")} disabled={agentRename.saving} />
          <div className="rename-dialog-actions">
            <button type="button" disabled={agentRename.saving} onClick={agentRename.onClose}>{t("common.cancel")}</button>
            <button type="submit" disabled={agentRename.saving}>{agentRename.saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </form>
      </div>
    )}
    {fileRename && (
      <div className="config-modal-overlay" onClick={fileRename.onClose}>
        <div className="config-modal-dialog" onClick={(e) => e.stopPropagation()}>
          <strong>{t("drawer.renameTitle")}</strong>
          <div style={{ margin: "12px 0" }}>
            <input type="text" value={fileRename.inputValue} onChange={(e) => fileRename.onInputChange(e.target.value)} className="config-input" autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") { const n = fileRename.inputValue.trim(); if (n && n !== fileRename.name) fileRename.onConfirm(fileRename.path, n); else fileRename.onClose(); }
                if (e.key === "Escape") fileRename.onClose();
              }}
            />
          </div>
          <div className="config-modal-actions">
            <button className="config-btn" onClick={fileRename.onClose}>{t("common.cancel")}</button>
            <button className="config-btn primary" onClick={() => { const n = fileRename.inputValue.trim(); if (n && n !== fileRename.name) fileRename.onConfirm(fileRename.path, n); else fileRename.onClose(); }}>{t("common.confirm")}</button>
          </div>
        </div>
      </div>
    )}
  </>;
}
