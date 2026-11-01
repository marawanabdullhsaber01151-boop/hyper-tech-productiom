import "../copy/engineering";
import { useState } from "preact/hooks";
import { staffUser } from "../admin/session";
import { t } from "../copy";
import { InlineAlert, Tabs } from "../design/components";
import { EngineeringChanges } from "./EngineeringChanges";
import { EngineeringRecipes } from "./EngineeringRecipes";
import { EngineeringVersions } from "./EngineeringVersions";
import { ENGINEERING_ROLES } from "./engineeringCore";
import { canViewRecipes } from "./recipesCore";
import "./Engineering.css";

export type EngineeringTab = "versions" | "changes" | "recipes";

/** التبويبات اللي الدور يشوفها. */
export const engineeringTabs = (role: string): EngineeringTab[] => [
  ...((ENGINEERING_ROLES as readonly string[]).includes(role) ? (["versions", "changes"] as const) : []),
  ...(canViewRecipes(role) ? (["recipes"] as const) : []),
];

/** صفحة الهندسة: إصدارات المنتج وطلبات التغيير ووصفات التصنيع. */
export function Engineering() {
  const role = staffUser()?.role ?? "";
  const allowed = engineeringTabs(role);
  const start = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<EngineeringTab>(() => (allowed.includes(start as EngineeringTab) ? (start as EngineeringTab) : (allowed[0] ?? "versions")));
  if (!allowed.length) return <div class="ad-page"><InlineAlert tone="warn">{t("eng.noAccess")}</InlineAlert></div>;
  const defs = {
    versions: { label: t("eng.tab.versions"), panel: <EngineeringVersions /> },
    changes: { label: t("eng.tab.changes"), panel: <EngineeringChanges /> },
    recipes: { label: t("eng.tab.recipes"), panel: <EngineeringRecipes /> },
  } as const;
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("eng.title")}</h1>
        <p class="st-login__sub">{t("eng.subtitle")}</p>
      </div>
      <Tabs value={tab} onChange={(v) => setTab(v as EngineeringTab)} tabs={allowed.map((id) => ({ id, label: defs[id].label, panel: defs[id].panel }))} />
    </div>
  );
}
