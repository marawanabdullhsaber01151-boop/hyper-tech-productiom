import "../copy/operations";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, DataTable, EmptyState, InlineAlert, StatusPill, type Column } from "../design/components";
import { RefreshCw } from "../design/icons";
import { formatDate, formatNumber } from "../lib/format";
import { sortSummaries, standingTone, type PromiseSummary } from "./promisesCore";

/** تبويب «الوعود»: الحالات المفتوحة اللي ليها وعد تسليم مثبّت، الأول والحالي ومقارنته بموعد الحالة. */
export function OperationsPromises({ onOpen }: { onOpen: (id: number) => void }) {
  const q = useQuery((signal) => api.get<PromiseSummary[]>("/operations-center/promises", { signal }), []);
  const rows = sortSummaries(Array.isArray(q.data) ? q.data : []);
  const cols: Column<PromiseSummary>[] = [
    { key: "c", header: t("opc.prm.case"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => onOpen(r.caseId)}>{r.caseNumber}</Button>, mobile: "title" },
    { key: "u", header: t("opc.prm.customer"), cell: (r) => r.customer ?? "—" },
    { key: "d", header: t("opc.prm.due"), cell: (r) => (r.dueDate ? formatDate(r.dueDate) : "—") },
    { key: "f", header: t("opc.prm.first"), cell: (r) => formatDate(r.first.promisedDate), mobile: "hide" },
    { key: "p", header: t("opc.prm.current"), cell: (r) => <strong>{formatDate(r.current.promisedDate)}</strong> },
    { key: "n", header: t("opc.prm.revisions"), cell: (r) => formatNumber(r.revisions), numeric: true, mobile: "hide" },
    { key: "s", header: t("opc.prm.standing"), cell: (r) => <StatusPill tone={standingTone(r.standing)}>{t(`opc.prm.st.${r.standing}`)}</StatusPill> },
  ];
  return (
    <div class="opc-stack">
      <div class="opc-toolbar">
        <p class="opc-muted">{t("opc.prm.note")}</p>
        <Button variant="secondary" icon={RefreshCw} loading={q.loading} onClick={() => void q.refetch()}>{t("opc.refresh")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("opc.err")}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.caseId} caption={t("opc.prm.caption")} loading={q.loading} empty={<EmptyState title={t("opc.prm.empty")} compact />} />
    </div>
  );
}
