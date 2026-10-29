#!/usr/bin/env bash
# اختبار استرجاع حقيقي: ينزّل آخر نسخة من كل مخزن، يتأكد من البصمة، يفك التشفير، يسترجع في قاعدة مؤقتة،
# ويقارن عدد الصفوف في كل جدول مع اللي اتسجّل وقت النسخ. أي فرق = فشل.
# يحتاج: RESTORE_ADMIN_URL (قاعدة postgres مؤقتة تتمسح بعد الاختبار) و BACKUP_AGE_PRIVATE_KEY.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/backup/common.sh

[ -n "${BACKUP_AGE_PRIVATE_KEY:-}" ] || die "BACKUP_AGE_PRIVATE_KEY ناقص."
ADMIN="${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL ناقص (قاعدة مؤقتة للاختبار فقط)}"
case "$ADMIN" in *neon.tech*|*amazonaws*|*supabase*) die "RESTORE_ADMIN_URL شكله قاعدة حقيقية! الاختبار لازم يشتغل على قاعدة مؤقتة فقط.";; esac
mapfile -t STORES < <(configured_stores | grep -v '^$' || true)
[ "${#STORES[@]}" -gt 0 ] || die "مفيش مخزن واحد إعداداته كاملة."

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
( umask 077; printf '%s\n' "$BACKUP_AGE_PRIVATE_KEY" > "$work/key.txt" )
TARGET="${ADMIN%/*}/restore_check"
export WORK="$work" TARGET ADMIN
failed=0
for store in "${STORES[@]}"; do
  rm -f "$work/key-${store}.txt"
  if bash scripts/backup/restore-store.sh "$store" 2> "$work/err-${store}.txt"; then
    record_run restore_test ok "$store" "$(cat "$work/key-${store}.txt")" "" "" "$work/restored.json" ""
    log "✔ ${store}: الاسترجاع سليم والصفوف مطابقة"
  else
    failed=1
    err="$(tail -c 500 "$work/err-${store}.txt" | tr '\n' ' ')"
    log "✖ ${store}: فشل — ${err}"
    record_run restore_test failed "$store" "$(cat "$work/key-${store}.txt" 2>/dev/null || true)" "" "" "" "$err"
  fi
  rm -f "$work/db.dump" "$work/db.dump.age" "$work/manifest.json" "$work/restored.json"
done
[ "$failed" = 0 ] || die "اختبار الاسترجاع فشل على مخزن واحد على الأقل."
