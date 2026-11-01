import "../copy/engineering";
import { useRef, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatMoney, formatNumber } from "../lib/format";
import {
  canEditRecipes, costSummary, filterRecipes, imageError, itemError, itemPayload, joinNames, moveImage, piastersToEgp, recipeError, recipePayload, recipeStats, secondaryIds, unlinkedItems,
  type RecipeFilter, type RecipeImage, type RecipeItemRow, type RecipeRow,
} from "./recipesCore";

interface RecipeLookups { products: { id: number; code: string; name: string }[]; inventory: { id: number; code: string | null; name: string; unit: string | null }[] }
interface RecipeDetail extends RecipeRow { items: RecipeItemRow[]; images: RecipeImage[] }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const chk = (e: Event) => (e.target as HTMLInputElement).checked;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t("rcp.img.readFail")));
    r.readAsDataURL(file);
  });
}

/** وصفات التصنيع: قايمة بالمنتجات ووصفة كل واحد بمكوّناتها وتكلفتها وصورها. */
export function EngineeringRecipes() {
  const role = staffUser()?.role ?? "";
  const canEdit = canEditRecipes(role);
  const list = useQuery((signal) => api.get<RecipeRow[]>("/bom", { signal }), []);
  const lookupsQ = useQuery((signal) => api.get<RecipeLookups>("/bom/lookups", { signal }), []);
  const lookups: RecipeLookups = { products: lookupsQ.data?.products ?? [], inventory: lookupsQ.data?.inventory ?? [] };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RecipeFilter>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const all = Array.isArray(list.data) ? list.data : [];
  const stats = recipeStats(all);
  const rows = filterRecipes(all, search, filter);

  const columns: Column<RecipeRow>[] = [
    { key: "code", header: t("rcp.col.code"), cell: (r) => <strong>{r.productCode ?? t("rcp.noCode")}</strong>, mobile: "title" },
    { key: "name", header: t("rcp.col.name"), cell: (r) => r.productName },
    { key: "out", header: t("rcp.col.out"), cell: (r) => formatNumber(Number(r.outputQty)), mobile: "hide" },
    { key: "link", header: t("rcp.col.link"), cell: (r) => (r.foundationItemId ? <StatusPill tone="success">{t("rcp.linked")}</StatusPill> : <StatusPill tone="warn">{t("rcp.unlinked")}</StatusPill>), mobile: "hide" },
    { key: "status", header: t("rcp.col.status"), cell: (r) => <StatusPill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? t("rcp.active") : t("rcp.inactive")}</StatusPill> },
    { key: "act", header: t("rcp.col.action"), cell: (r) => <Button size="sm" variant={r.id === openId ? "primary" : "secondary"} onClick={() => setOpenId(r.id === openId ? null : r.id)}>{t("rcp.open")}</Button> },
  ];

  return (
    <>
      <div class="eng-stats">
        <Stat label={t("rcp.stat.total")} value={formatNumber(stats.total)} />
        <Stat label={t("rcp.stat.active")} value={formatNumber(stats.active)} />
        <Stat label={t("rcp.stat.inactive")} value={formatNumber(stats.inactive)} />
        <Stat label={t("rcp.stat.unlinked")} value={formatNumber(stats.unlinked)} hint={stats.unlinked ? t("rcp.stat.unlinked.hint") : undefined} />
      </div>
      <div class="eng-toolbar">
        <Input aria-label={t("rcp.search")} placeholder={t("rcp.search")} value={search} onInput={(e) => setSearch(val(e))} />
        <Select aria-label={t("rcp.filter")} value={filter} onChange={(e) => setFilter(val(e) as RecipeFilter)} options={(["all", "active", "inactive", "unlinked"] as const).map((f) => ({ value: f, label: t(`rcp.filter.${f}` as CopyKey) }))} />
        {canEdit ? <Button icon={Plus} onClick={() => setCreating(true)}>{t("rcp.new")}</Button> : null}
      </div>
      {list.error ? <InlineAlert tone="danger" title={t("eng.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("rcp.caption")} loading={list.loading} empty={<EmptyState title={all.length ? t("rcp.emptyFiltered") : t("rcp.empty")} compact />} />
      {openId !== null ? <RecipeDetailPanel key={openId} id={openId} canEdit={canEdit} lookups={lookups} onChanged={() => void list.refetch()} onGone={() => { setOpenId(null); void list.refetch(); }} /> : null}
      {creating ? <RecipeDialog lookups={lookups} onClose={() => setCreating(false)} onDone={async (id) => { setCreating(false); await list.refetch(); setOpenId(id); }} /> : null}
    </>
  );
}

type Pending = { kind: "toggle" } | { kind: "delete" } | { kind: "removeItem"; row: RecipeItemRow } | { kind: "removeImage"; image: RecipeImage };
type Editing = { kind: "recipe" } | { kind: "item"; row: RecipeItemRow | null };

function RecipeDetailPanel({ id, canEdit, lookups, onChanged, onGone }: { id: number; canEdit: boolean; lookups: RecipeLookups; onChanged: () => void; onGone: () => void }) {
  const q = useQuery((signal) => api.get<RecipeDetail>(`/bom/${id}`, { signal }), [id]);
  const act = useAct();
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const r = q.data;
  const refresh = async () => { await q.refetch(); onChanged(); };
  if (q.error) return <InlineAlert tone="danger" title={t("eng.err")}>{q.error.message}</InlineAlert>;
  if (!r) return <p class="eng-muted">{t("common.loading")}</p>;

  const items = Array.isArray(r.items) ? r.items : [];
  const images = Array.isArray(r.images) ? r.images : [];
  const cost = costSummary(items, r.outputQty);
  const unlinked = unlinkedItems(items);

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    const done = await act.run(async () => { await fn(); return true; }, ok);
    if (done) { setPending(null); await refresh(); }
    return done;
  };

  const itemColumns: Column<RecipeItemRow>[] = [
    { key: "name", header: t("rcp.i.col.name"), cell: (i) => <>{i.materialName}{i.isFeatured ? <> <StatusPill tone="info">{t("rcp.i.featured")}</StatusPill></> : null}</>, mobile: "title" },
    { key: "qty", header: t("rcp.i.col.qty"), cell: (i) => `${formatNumber(Number(i.qty))} ${i.unit}` },
    { key: "cost", header: t("rcp.i.col.cost"), cell: (i) => formatMoney(Number(i.unitCost)), mobile: "hide" },
    { key: "link", header: t("rcp.i.col.link"), cell: (i) => (i.linked ? <StatusPill tone="success">{t("rcp.linked")}</StatusPill> : <StatusPill tone="warn">{t("rcp.i.unlinked")}</StatusPill>) },
    ...(canEdit ? [{ key: "act", header: t("rcp.col.action"), cell: (i: RecipeItemRow) => <div class="eng-actions"><Button size="sm" variant="secondary" onClick={() => setEditing({ kind: "item", row: i })}>{t("common.edit")}</Button><Button size="sm" variant="ghost" onClick={() => setPending({ kind: "removeItem", row: i })}>{t("rcp.i.remove")}</Button></div> } satisfies Column<RecipeItemRow>] : []),
  ];

  return (
    <section class="eng-stack" aria-label={t("rcp.d.title", { name: r.productName })}>
      <div class="eng-toolbar">
        <h2 class="eng-h">{t("rcp.d.title", { name: r.productName })}</h2>
        <StatusPill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? t("rcp.active") : t("rcp.inactive")}</StatusPill>
        {canEdit ? (
          <div class="eng-actions">
            <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: "recipe" })}>{t("common.edit")}</Button>
            <Button size="sm" variant="secondary" onClick={() => (r.isActive ? setPending({ kind: "toggle" }) : void call(() => api.patch<unknown>(`/bom/${id}`, { isActive: true }), t("rcp.d.activated")))}>{r.isActive ? t("rcp.d.deactivate") : t("rcp.d.activate")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "delete" })}>{t("rcp.d.delete")}</Button>
          </div>
        ) : null}
      </div>
      {!r.foundationItemId ? <InlineAlert tone="warn">{t("rcp.d.unlinkedWarn")}</InlineAlert> : null}
      {unlinked.length ? <InlineAlert tone="warn" title={t("rcp.d.blockTitle")}>{t("rcp.d.blockBody", { n: unlinked.length, names: joinNames(unlinked.map((i) => i.materialName)) })}</InlineAlert> : null}
      <div class="eng-stats">
        <Stat label={t("rcp.d.out")} value={formatNumber(Number(r.outputQty))} />
        <Stat label={t("rcp.d.batchCost")} value={formatMoney(Number(piastersToEgp(cost.batchPiasters)))} hint={cost.unpriced ? t("rcp.d.unpriced", { n: cost.unpriced }) : undefined} />
        <Stat label={t("rcp.d.unitCost")} value={formatMoney(Number(piastersToEgp(cost.unitPiasters)))} />
        <Stat label={t("rcp.d.refPrice")} value={r.referencePrice ? formatMoney(Number(r.referencePrice)) : t("rcp.d.none")} />
      </div>
      {r.description ? <p class="eng-muted">{r.description}</p> : null}

      <div class="eng-toolbar">
        <h3 class="eng-h">{t("rcp.i.title")}</h3>
        {canEdit ? <Button size="sm" icon={Plus} onClick={() => setEditing({ kind: "item", row: null })}>{t("rcp.i.add")}</Button> : null}
      </div>
      <DataTable columns={itemColumns} rows={items} rowKey={(i) => i.id} caption={t("rcp.i.title")} empty={<EmptyState title={t("rcp.i.none")} compact />} />

      <ImagesPanel recipeId={id} images={images} canEdit={canEdit} act={act} onChanged={refresh} onRemove={(image) => setPending({ kind: "removeImage", image })} />

      <ConfirmDialog open={pending?.kind === "toggle"} onClose={() => setPending(null)} title={t("rcp.d.deactivate")} description={t("rcp.d.confirmDeactivate")} confirmLabel={t("rcp.d.deactivate")} loading={act.busy} onConfirm={() => void call(() => api.patch<unknown>(`/bom/${id}`, { isActive: false }), t("rcp.d.deactivated"))} />
      <ConfirmDialog open={pending?.kind === "delete"} onClose={() => setPending(null)} title={t("rcp.d.delete")} description={t("rcp.d.confirmDelete")} danger confirmLabel={t("rcp.d.delete")} loading={act.busy} onConfirm={async () => { const ok = await act.run(async () => { await api.delete<unknown>(`/bom/${id}`); return true; }, t("rcp.d.deleted")); if (ok) onGone(); else setPending(null); }} />
      <ConfirmDialog open={pending?.kind === "removeItem"} onClose={() => setPending(null)} title={t("rcp.i.remove")} description={pending?.kind === "removeItem" ? t("rcp.i.confirmRemove", { name: pending.row.materialName }) : undefined} danger confirmLabel={t("rcp.i.remove")} loading={act.busy} onConfirm={() => { if (pending?.kind === "removeItem") void call(() => api.delete<unknown>(`/bom/${id}/items/${pending.row.id}`), t("rcp.i.removed")); }} />
      <ConfirmDialog open={pending?.kind === "removeImage"} onClose={() => setPending(null)} title={t("rcp.img.remove")} description={t("rcp.img.confirmRemove")} danger confirmLabel={t("rcp.img.remove")} loading={act.busy} onConfirm={() => { if (pending?.kind === "removeImage") void call(() => api.delete<unknown>(`/bom/${id}/images/${pending.image.id}`), t("rcp.img.removed")); }} />

      {editing?.kind === "recipe" ? <RecipeDialog recipe={r} lookups={lookups} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await refresh(); }} /> : null}
      {editing?.kind === "item" ? <ItemDialog recipeId={id} row={editing.row} lookups={lookups} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await refresh(); }} /> : null}
    </section>
  );
}

function ImagesPanel({ recipeId, images, canEdit, act, onChanged, onRemove }: { recipeId: number; images: RecipeImage[]; canEdit: boolean; act: ReturnType<typeof useAct>; onChanged: () => Promise<void>; onRemove: (i: RecipeImage) => void }) {
  const primaryRef = useRef<HTMLInputElement>(null);
  const secondaryRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const primary = images.find((i) => i.role === "primary") ?? null;
  const secondary = images.filter((i) => i.role === "secondary").sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = secondaryIds(images);

  const upload = async (role: "primary" | "secondary", e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const bad = imageError(file);
    if (bad) { setProblem(bad === "type" ? t("rcp.img.errType") : t("rcp.img.errSize")); return; }
    setProblem(null);
    const ok = await act.run(async () => { await api.post<unknown>(`/bom/${recipeId}/images/${role}`, { imageData: await readImage(file) }); return true; }, t("rcp.img.saved"));
    if (ok) await onChanged();
  };
  const move = async (id: number, dir: -1 | 1) => {
    const ok = await act.run(async () => { await api.patch<unknown>(`/bom/${recipeId}/images/reorder`, { order: moveImage(ids, id, dir) }); return true; });
    if (ok) await onChanged();
  };

  return (
    <div class="eng-stack">
      <div class="eng-toolbar">
        <h3 class="eng-h">{t("rcp.img.title")}</h3>
      </div>
      <p class="eng-muted">{t("rcp.img.hint")}</p>
      {problem ? <InlineAlert tone="danger">{problem}</InlineAlert> : null}
      <div class="rcp-gallery">
        <figure class="rcp-img">
          {primary ? <img src={primary.imageData} alt={t("rcp.img.primary")} /> : <div class="rcp-img__empty">{t("rcp.img.noPrimary")}</div>}
          <figcaption>{t("rcp.img.primary")}</figcaption>
          {canEdit ? (
            <div class="eng-actions">
              <input ref={primaryRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload("primary", e)} />
              <Button size="sm" variant="secondary" loading={act.busy} onClick={() => primaryRef.current?.click()}>{primary ? t("rcp.img.replace") : t("rcp.img.addPrimary")}</Button>
              {primary ? <Button size="sm" variant="ghost" onClick={() => onRemove(primary)}>{t("rcp.img.remove")}</Button> : null}
            </div>
          ) : null}
        </figure>
        {secondary.map((im, idx) => (
          <figure class="rcp-img" key={im.id}>
            <img src={im.imageData} alt={t("rcp.img.secondaryN", { n: idx + 1 })} />
            <figcaption>{t("rcp.img.secondaryN", { n: idx + 1 })}</figcaption>
            {canEdit ? (
              <div class="eng-actions">
                <Button size="sm" variant="ghost" disabled={idx === 0 || act.busy} aria-label={t("rcp.img.earlier")} onClick={() => void move(im.id, -1)}>{t("rcp.img.earlier")}</Button>
                <Button size="sm" variant="ghost" disabled={idx === secondary.length - 1 || act.busy} aria-label={t("rcp.img.later")} onClick={() => void move(im.id, 1)}>{t("rcp.img.later")}</Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(im)}>{t("rcp.img.remove")}</Button>
              </div>
            ) : null}
          </figure>
        ))}
      </div>
      {canEdit ? (
        <div class="eng-actions">
          <input ref={secondaryRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload("secondary", e)} />
          <Button size="sm" icon={Plus} variant="secondary" loading={act.busy} onClick={() => secondaryRef.current?.click()}>{t("rcp.img.addSecondary")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function RecipeDialog({ recipe, lookups, onClose, onDone }: { recipe?: RecipeDetail; lookups: RecipeLookups; onClose: () => void; onDone: (id: number) => void | Promise<void> }) {
  const act = useAct();
  const editing = Boolean(recipe);
  const [f, setF] = useState({
    foundationItemId: recipe?.foundationItemId ? String(recipe.foundationItemId) : "",
    description: recipe?.description ?? "",
    outputQty: recipe ? String(Number(recipe.outputQty)) : "1",
    referencePrice: recipe?.referencePrice ? String(Number(recipe.referencePrice)) : "",
    expectedDays: recipe?.expectedProductionDays ? String(recipe.expectedProductionDays) : "",
  });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  // وصفة قديمة من غير ربط: التعديل بيسمح بربطها بمنتج تام، لكن مش بيجبره.
  const canPickProduct = !editing || !recipe?.foundationItemId;
  const err = recipeError(f, !editing);
  const save = async () => {
    const id = await act.run(async () => {
      const body = recipePayload(f, canPickProduct && Boolean(f.foundationItemId));
      if (recipe) { await api.patch<unknown>(`/bom/${recipe.id}`, body); return recipe.id; }
      const created = await api.post<{ id: number }>("/bom", body);
      return created.id;
    }, editing ? t("rcp.f.updated") : t("rcp.f.created"));
    if (id !== undefined) await onDone(id);
  };
  return (
    <Dialog open onClose={onClose} title={editing ? t("rcp.f.editTitle") : t("rcp.new")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("common.save")}</Button></>}>
      <div class="eng-form">
        {canPickProduct ? (
          <Field label={t("rcp.f.product")} required={!editing} hint={lookups.products.length ? t("rcp.f.productHint") : undefined}>
            {lookups.products.length ? <Select value={f.foundationItemId} options={[{ value: "", label: t("rcp.f.productPick") }, ...lookups.products.map((p) => ({ value: String(p.id), label: `${p.code} | ${p.name}` }))]} onChange={set("foundationItemId")} /> : <InlineAlert tone="warn">{t("rcp.f.noProducts")}</InlineAlert>}
          </Field>
        ) : <p class="eng-muted">{t("rcp.f.productFixed", { name: recipe?.productName ?? "" })}</p>}
        <Field label={t("rcp.f.out")} required error={err === "outputQty" ? t("rcp.f.err.out") : undefined} hint={t("rcp.f.outHint")}><Input inputMode="decimal" value={f.outputQty} onInput={set("outputQty")} /></Field>
        <Field label={t("rcp.f.ref")} error={err === "referencePrice" ? t("rcp.f.err.ref") : undefined} hint={t("rcp.f.refHint")}><Input inputMode="decimal" value={f.referencePrice} onInput={set("referencePrice")} /></Field>
        <Field label={t("rcp.f.days")} error={err === "days" ? t("rcp.f.err.days") : undefined}><Input inputMode="numeric" value={f.expectedDays} onInput={set("expectedDays")} /></Field>
        <Field label={t("rcp.f.desc")}><Textarea value={f.description} maxLength={2000} onInput={set("description")} /></Field>
      </div>
    </Dialog>
  );
}

function ItemDialog({ recipeId, row, lookups, onClose, onDone }: { recipeId: number; row: RecipeItemRow | null; lookups: RecipeLookups; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [f, setF] = useState({
    inventoryItemId: row?.inventoryItemId ? String(row.inventoryItemId) : "",
    materialName: row?.materialName ?? "",
    qty: row ? String(Number(row.qty)) : "",
    unit: row?.unit ?? "",
    unitCost: row && Number(row.unitCost) > 0 ? String(Number(row.unitCost)) : "",
    isFeatured: row?.isFeatured ?? false,
    featuredImageData: row?.featuredImageData ?? (null as string | null),
  });
  const set = (k: "materialName" | "qty" | "unit" | "unitCost") => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = itemError(f);
  const pickInventory = (e: Event) => {
    const id = val(e);
    const it = lookups.inventory.find((i) => String(i.id) === id);
    setF({ ...f, inventoryItemId: id, materialName: it ? it.name : f.materialName, unit: it?.unit && !f.unit ? it.unit : f.unit });
  };
  const pickImage = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const bad = imageError(file);
    if (bad) { setProblem(bad === "type" ? t("rcp.img.errType") : t("rcp.img.errSize")); return; }
    setProblem(null);
    try { setF({ ...f, featuredImageData: await readImage(file) }); } catch (x) { setProblem((x as Error).message); }
  };
  const save = async () => {
    const ok = await act.run(async () => {
      const body = itemPayload(f);
      if (row) await api.patch<unknown>(`/bom/${recipeId}/items/${row.id}`, body);
      else await api.post<unknown>(`/bom/${recipeId}/items`, body);
      return true;
    }, row ? t("rcp.i.updated") : t("rcp.i.added"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={row ? t("rcp.i.edit") : t("rcp.i.add")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("common.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("rcp.i.f.inv")} hint={t("rcp.i.f.invHint")}>
          <Select value={f.inventoryItemId} options={[{ value: "", label: t("rcp.i.f.invNone") }, ...lookups.inventory.map((i) => ({ value: String(i.id), label: i.code ? `${i.code} | ${i.name}` : i.name }))]} onChange={pickInventory} />
        </Field>
        <Field label={t("rcp.i.f.name")} required={!f.inventoryItemId}><Input value={f.materialName} maxLength={180} onInput={set("materialName")} /></Field>
        <Field label={t("rcp.i.f.qty")} required error={f.qty && err === "qty" ? t("rcp.i.err.qty") : undefined} hint={t("rcp.i.f.qtyHint")}><Input inputMode="decimal" value={f.qty} onInput={set("qty")} /></Field>
        <Field label={t("rcp.i.f.unit")} required error={f.unit.length > 20 ? t("rcp.i.err.unit") : undefined}><Input value={f.unit} maxLength={20} onInput={set("unit")} /></Field>
        <Field label={t("rcp.i.f.cost")} error={err === "unitCost" ? t("rcp.i.err.cost") : undefined}><Input inputMode="decimal" value={f.unitCost} onInput={set("unitCost")} /></Field>
        <Checkbox label={t("rcp.i.f.featured")} checked={f.isFeatured} onChange={(e) => setF({ ...f, isFeatured: chk(e) })} />
        {f.isFeatured ? (
          <div class="eng-stack">
            <p class="eng-muted">{t("rcp.i.f.featuredHint")}</p>
            {f.featuredImageData ? <img class="rcp-thumb" src={f.featuredImageData} alt={t("rcp.i.f.image")} /> : null}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pickImage(e)} />
            <div class="eng-actions">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{f.featuredImageData ? t("rcp.img.replace") : t("rcp.i.f.image")}</Button>
              {f.featuredImageData ? <Button size="sm" variant="ghost" onClick={() => setF({ ...f, featuredImageData: null })}>{t("rcp.img.remove")}</Button> : null}
            </div>
            {problem ? <InlineAlert tone="danger">{problem}</InlineAlert> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
