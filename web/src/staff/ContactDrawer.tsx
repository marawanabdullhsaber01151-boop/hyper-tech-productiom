import { useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, Drawer, Icon, InlineAlert, Skeleton, StatusPill } from "../design/components";
import { staffUser } from "../admin/session";
import { Mail, MessageCircle, Pencil, Phone, Trash } from "../design/icons";
import { formatDate, formatMoney } from "../lib/format";
import { initials, isCustomer, isSellerRole, isSupplier, telLink, waLink, type ContactRow } from "./contactsCore";
import { poStatusLabel, poStatusTone } from "./PurchaseDetail";
import { statusLabel, statusTone } from "./SalesDetail";

interface Activity {
  sales: Array<{ id: number; orderNumber: string; status: string; total: string; date: string }>;
  purchases: Array<{ id: number; poNumber: string; status: string; createdAt: string }>;
}

const typeTone = (type: string) => (type === "supplier" ? "warn" : type === "both" ? "brand" : "info");

/** تفاصيل جهة الاتصال: أزرار اتصال/واتساب/إيميل بضغطة، وآخر الفواتير وأوامر الشراء، وتعديل وحذف. */
export function ContactDrawer({ contact, canWrite, onClose, onEdit, onDeleted, onOpenSale, onOpenPo, onAllSales }: { contact: ContactRow; canWrite: boolean; onClose: () => void; onEdit: () => void; onDeleted: () => void; onOpenSale: (id: number) => void; onOpenPo: (id: number) => void; onAllSales: () => void }) {
  const act = useAct();
  const [del, setDel] = useState(false);
  const activity = useQuery((signal) => api.get<Activity>(`/contacts/${contact.id}/activity`, { signal }), [contact.id]);
  const seller = isSellerRole(staffUser()?.role ?? "");
  const tel = telLink(contact.phone);
  const wa = waLink(contact.phone);
  const doDelete = async () => {
    const ok = await act.run(
      async () => {
        await api.delete<unknown>(`/contacts/${contact.id}`);
        return true;
      },
      t("con.deleted"),
    );
    setDel(false);
    if (ok) onDeleted();
  };
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={contact.name}
        footer={
          canWrite ? (
            <div class="con-foot">
              <Button variant="secondary" icon={Pencil} onClick={onEdit}>{t("con.edit")}</Button>
              <Button variant="ghost" icon={Trash} onClick={() => setDel(true)}>{t("con.delete")}</Button>
            </div>
          ) : undefined
        }
      >
        <div class="con-detail">
          <div class="con-head">
            <span class="con-avatar" aria-hidden="true">{initials(contact.name)}</span>
            <div class="con-pills">
              <StatusPill tone={typeTone(contact.type)}>{t(`con.type.${contact.type}` as CopyKey)}</StatusPill>
              {contact.segment ? <StatusPill tone="neutral">{t(`con.seg.${contact.segment}` as CopyKey)}</StatusPill> : null}
              {contact.city ? <StatusPill tone="neutral">{contact.city}</StatusPill> : null}
            </div>
          </div>
          <div class="con-quick">
            {tel ? <a class="ht-btn ht-btn--secondary" href={tel} aria-label={t("con.callnow", { name: contact.name })}><Icon icon={Phone} size={18} /><span class="ht-btn__label">{t("con.call")}</span></a> : null}
            {wa ? <a class="ht-btn ht-btn--secondary" href={wa} target="_blank" rel="noopener noreferrer" aria-label={t("con.wa.now", { name: contact.name })}><Icon icon={MessageCircle} size={18} /><span class="ht-btn__label">{t("con.whatsapp")}</span></a> : null}
            {contact.email ? <a class="ht-btn ht-btn--secondary" href={`mailto:${contact.email}`}><Icon icon={Mail} size={18} /><span class="ht-btn__label">{t("con.mail")}</span></a> : null}
          </div>
          <dl class="con-facts">
            {contact.company ? <div><dt>{t("con.ed.company")}</dt><dd>{contact.company}</dd></div> : null}
            {contact.phone ? <div><dt>{t("con.ed.phone")}</dt><dd dir="ltr">{contact.phone}</dd></div> : null}
            {contact.email ? <div><dt>{t("con.ed.email")}</dt><dd dir="ltr">{contact.email}</dd></div> : null}
            {contact.address ? <div><dt>{t("con.dr.address")}</dt><dd>{contact.address}</dd></div> : null}
            {contact.notes ? <div><dt>{t("con.dr.notes")}</dt><dd>{contact.notes}</dd></div> : null}
            <div><dt>{t("con.dr.since")}</dt><dd>{formatDate(contact.createdAt)}</dd></div>
          </dl>
          {activity.error ? <InlineAlert tone="warn">{t("con.dr.err")}</InlineAlert> : null}
          {isCustomer(contact) ? (
            <>
              <div class="con-hrow">
                <h3 class="con-h">{t("con.dr.sales")}</h3>
                {contact.salesCount > 0 ? <button type="button" class="con-link" onClick={onAllSales}>{t("con.dr.all")}</button> : null}
              </div>
              {activity.loading && !activity.data ? <Skeleton lines={2} /> : null}
              {activity.data && activity.data.sales.length === 0 ? <p class="con-muted">{t("con.dr.sales.none")}</p> : null}
              <ul class="con-recent">
                {(activity.data?.sales ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" class="con-link" onClick={() => onOpenSale(s.id)}>{s.orderNumber}</button>
                    <StatusPill tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusPill>
                    <span class="con-muted">{formatDate(s.date)}</span>
                    <strong class="con-num">{formatMoney(Number(s.total))}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {isSupplier(contact) && !seller ? (
            <>
              <h3 class="con-h">{t("con.dr.po")}</h3>
              {activity.data && activity.data.purchases.length === 0 ? <p class="con-muted">{t("con.dr.po.none")}</p> : null}
              <ul class="con-recent">
                {(activity.data?.purchases ?? []).map((p) => (
                  <li key={p.id}>
                    <button type="button" class="con-link" onClick={() => onOpenPo(p.id)}>{p.poNumber}</button>
                    <StatusPill tone={poStatusTone(p.status)}>{poStatusLabel(p.status)}</StatusPill>
                    <span class="con-muted">{formatDate(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Drawer>
      <ConfirmDialog open={del} danger loading={act.busy} onClose={() => setDel(false)} onConfirm={() => void doDelete()} title={t("con.del.title", { name: contact.name })} description={t("con.del.desc")} confirmLabel={t("con.delete")} />
    </>
  );
}
