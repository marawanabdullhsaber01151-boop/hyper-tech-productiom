import "../copy/warehouses";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Field, Select } from "../design/components";
import { needsPicker, pickForCategory, pickOptions, type WhItem, type WhKind } from "./warehousesCore";

interface ListDto { items: WhItem[] }

/** اختيار المخزن: بيظهر بس لو فيه أكتر من مخزن مسموح. فاضي = المخزن الافتراضي. */
export function WarehousePick({ category, kind, value, onChange, label, hint }: { category?: string; kind?: WhKind; value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  const q = useQuery((signal) => api.get<ListDto>("/warehouses", { signal }).catch(() => ({ items: [] as WhItem[] })), []);
  const all = q.data?.items ?? [];
  const opts = kind ? pickOptions(all, kind) : pickForCategory(all, category ?? "");
  if (!needsPicker(opts)) return null;
  return (
    <Field label={label ?? t("wh.pick")} hint={hint ?? t("wh.pick.hint")}>
      <Select
        value={value}
        options={[{ value: "", label: t("wh.pick.default") }, ...opts.map((w) => ({ value: String(w.id), label: w.name }))]}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
      />
    </Field>
  );
}
