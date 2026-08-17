/**
 * 用量明细表（模型/项目共用）：前 12 行 + 首列 title 全文。
 */

import { t } from "../../../i18n";

export function UsageTable(props: { headers: string[]; rows: string[][] }) {
  if (props.rows.length === 0) {
    return <div className="py-3 text-sm text-muted-foreground">{t("usageStats.table.empty")}</div>;
  }
  return (
    <table className="w-full min-w-[520px] border-collapse text-sm">
      <thead>
        <tr>
          {props.headers.map((h, i) => (
            <th key={i} scope="col" className={`border-b border-border-subtle px-2 py-2 text-left text-xs font-medium text-muted-foreground ${i > 0 ? "text-right" : ""}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.slice(0, 12).map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} title={ci === 0 ? cell : undefined} className={`max-w-[320px] truncate border-b border-border-subtle px-2 py-2 tabular-nums text-foreground ${ci > 0 ? "text-right" : ""}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
