import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Dialog, Field, InlineAlert, Radio, StatusPill, Textarea } from "../design/components";
import { formatNumber } from "../lib/format";
import { PREPARE_ONLY_ROLES, decisionBody, defaultMode, defaultQty, materialsError, shortMaterials, shortageOf, type CheckedMaterial, type MaterialsMode } from "./materialsRules";
import type { OrderRow } from "./ProductionOrders";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const MODES: readonly MaterialsMode[] = ["approve", "partial", "reject"];

/** قرار المخزن على خامات أمر الإنتاج: فحص حي للمتاح، ثم اعتماد كامل أو جزئي أو رفض بسبب. */
export function MaterialsDialog({ row, role, onClose, onDone }: { row: OrderRow; role: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const check = useQuery((signal) => api.get<{ materials: CheckedMaterial[]; allSufficient: boolean }>(`/production-workflow/${row.id}/materials-check`, { signal }), [row.id]);
  const list = check.data?.materials ?? [];
  const [picked, setPicked] = useState<MaterialsMode | null>(null);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [comment, setComment] = useState("");
  const mode = picked ?? defaultMode(list);
  const qtys: Record<number, string> = {};
  for (const m of list) qtys[m.inventoryItemId] = typed[m.inventoryItemId] ?? defaultQty(m);
  const short = shortMaterials(list);
  const problem = materialsError({ mode, comment, list, qtys });
  const ready = check.data !== null && check.data !== undefined && !check.loading;
  const prepareOnly = (PREPARE_ONLY_ROLES as readonly string[]).includes(role);

  const send = async () => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/production-workflow/${row.id}/warehouse-action`, decisionBody({ mode, comment, list, qtys }));
      return true;
    }, t("prd.ord.m.done"));
    if (ok) await onDone();
  };
  const problemText = problem.code === null ? undefined : t(`prd.ord.m.err.${problem.code}` as CopyKey, { names: problem.names.join(t("prd.ord.m.sep")) });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("prd.ord.m.title", { no: row.orderNumber })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant={mode === "reject" ? "danger" : "primary"} loading={act.busy} disabled={!ready || problem.code !== null} onClick={() => void send()}>{t("prd.ord.m.send")}</Button></>}
    >
      <div class="prd-form">
        <p class="prd-muted">{t("prd.ord.m.text")}</p>
        <p><strong>{row.productName}</strong> | {formatNumber(Number(row.qty))} {row.unit}</p>
        {check.error ? <InlineAlert tone="danger" title={t("prd.ord.m.fail")}>{check.error.message}</InlineAlert> : null}
        {check.loading ? <p class="prd-muted">{t("prd.ord.m.loading")}</p> : null}
        {ready && !list.length ? <InlineAlert tone="info">{t("prd.ord.m.empty")}</InlineAlert> : null}
        {ready && list.length ? (
          <>
            <p class={short.length ? "prd-warn" : "prd-ok"}>{short.length ? t("prd.ord.m.summary", { short: formatNumber(short.length), total: formatNumber(list.length) }) : t("prd.ord.m.allOk")}</p>
            <div class="prd-scroll">
              <table class="prd-mat">
                <caption class="prd-sr">{t("prd.ord.m.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("prd.ord.m.col.material")}</th>
                    <th scope="col">{t("prd.ord.m.col.required")}</th>
                    <th scope="col">{t("prd.ord.m.col.available")}</th>
                    <th scope="col">{t("prd.ord.m.col.state")}</th>
                    {mode === "partial" ? <th scope="col">{t("prd.ord.m.col.approved")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.inventoryItemId}>
                      <th scope="row">{m.materialName}</th>
                      <td>{formatNumber(Number(m.requestedQty))} {m.unit}</td>
                      <td>{formatNumber(Number(m.availableQty))} {m.unit}</td>
                      <td>{m.sufficient ? <StatusPill tone="success">{t("prd.ord.m.ok")}</StatusPill> : <StatusPill tone="danger">{t("prd.ord.m.short", { n: formatNumber(shortageOf(m)), unit: m.unit })}</StatusPill>}</td>
                      {mode === "partial" ? (
                        <td>
                          <input
                            class="prd-qty"
                            inputMode="decimal"
                            aria-label={t("prd.ord.m.qtyFor", { name: m.materialName })}
                            value={qtys[m.inventoryItemId]}
                            onInput={(e) => setTyped({ ...typed, [m.inventoryItemId]: val(e) })}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {ready ? (
          <>
            <div role="radiogroup" aria-label={t("prd.ord.m.mode")} class="prd-modes">
              {MODES.map((m) => (
                <Radio key={m} name={`mode-${row.id}`} label={t(`prd.ord.m.mode.${m}` as CopyKey)} checked={mode === m} disabled={m === "approve" && short.length > 0} onChange={() => setPicked(m)} />
              ))}
            </div>
            {mode === "approve" ? <p class="prd-muted">{prepareOnly ? t("prd.ord.m.after.prepare") : t("prd.ord.m.after.deduct")}</p> : null}
            {mode === "partial" ? <p class="prd-muted">{prepareOnly ? t("prd.ord.m.after.prepare") : t("prd.ord.m.after.deduct")}</p> : null}
            {mode === "reject" ? <p class="prd-muted">{t("prd.ord.m.after.reject")}</p> : null}
            <Field label={mode === "reject" ? t("prd.ord.m.reason") : t("prd.ord.m.note")} required={mode === "reject"} error={mode === "reject" && comment && problem.code === "reason" ? t("prd.ord.m.err.reason") : undefined}>
              <Textarea rows={2} maxLength={300} value={comment} onInput={(e) => setComment(val(e))} />
            </Field>
            {problemText && !(mode === "reject" && problem.code === "reason") ? <InlineAlert tone="warn">{problemText}</InlineAlert> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
