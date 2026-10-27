import { useState } from "preact/hooks";
import { staffUser } from "../admin/session";
import { t } from "../copy";
import { InlineAlert, Tabs } from "../design/components";
import { ProductionQuality, ProductionTrace } from "./ProductionQuality";
import { ProductionRequests } from "./ProductionRequests";
import { PRODUCTION_PAGE_ROLES, availableTabs, type ProductionTab } from "./productionRules";
import "./Production.css";

export { PRODUCTION_PAGE_ROLES };

/** صفحة الإنتاج: طلبات الإنتاج، الجودة، وتتبع التشغيلة. كل دور يشوف التبويبات المسموحة له بس. */
export function Production() {
  const role = staffUser()?.role ?? "";
  const allowed = availableTabs(role);
  const start = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<ProductionTab>(() => (allowed.includes(start as ProductionTab) ? (start as ProductionTab) : (allowed[0] ?? "requests")));

  if (!allowed.length) return <div class="ad-page"><InlineAlert tone="warn">{t("prd.noAccess")}</InlineAlert></div>;

  const defs = {
    requests: { label: t("prd.tab.requests"), panel: <ProductionRequests /> },
    quality: { label: t("prd.tab.quality"), panel: <ProductionQuality /> },
    trace: { label: t("prd.tab.trace"), panel: <ProductionTrace /> },
  } as const;

  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("prd.title")}</h1>
        <p class="st-login__sub">{t("prd.subtitle")}</p>
      </div>
      <Tabs value={tab} onChange={(v) => setTab(v as ProductionTab)} tabs={allowed.map((id) => ({ id, label: defs[id].label, panel: defs[id].panel }))} />
    </div>
  );
}
