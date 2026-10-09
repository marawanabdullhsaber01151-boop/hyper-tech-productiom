import { t } from "../../copy";
export function Spinner({ label = t("common.loading") }: { label?: string }) {
  return (
    <span class="ht-spinner" role="status" aria-label={label}>
      <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" opacity=".25" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    </span>
  );
}
