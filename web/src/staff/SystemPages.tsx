import { Link } from "../app/router";
import { t } from "../copy";
import { EmptyState } from "../design/components";

const Back = () => <Link to="/staff" class="ht-btn ht-btn--secondary">{t("staff.system.backHome")}</Link>;

export function StaffNotFound() {
  return <div class="ad-page"><EmptyState title={t("staff.system.notFound.title")} description={t("staff.system.notFound.body")} action={<Back />} /></div>;
}

export function Forbidden() {
  return <div class="ad-page"><EmptyState title={t("staff.system.forbidden.title")} description={t("staff.system.forbidden.body")} action={<Back />} /></div>;
}

export function Maintenance() {
  return <div class="ad-page"><EmptyState title={t("staff.system.maintenance.title")} description={t("staff.system.maintenance.body")} /></div>;
}
