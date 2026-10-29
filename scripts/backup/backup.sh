#!/usr/bin/env bash
# نسخة احتياطية مشفّرة: pg_dump ← تشفير age (بالمفتاح العام فقط) ← رفع لكل مخزن مضبوط ← فحص الحجم ← تنظيف القديم.
# التشغيل: من GitHub Actions (backup.yml) أو يدويًا لو المتغيرات موجودة. بيفشل بصوت عالي لو أي مخزن فشل.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/backup/common.sh

DB_URL="$(db_url)"
[ -n "$DB_URL" ] || die "مفيش رابط قاعدة بيانات (BACKUP_DATABASE_URL أو DATABASE_URL)."
case "${BACKUP_AGE_PUBLIC_KEY:-}" in age1*) ;; *) die "BACKUP_AGE_PUBLIC_KEY ناقص أو شكله غلط (لازم يبدأ بـ age1).";; esac
mapfile -t STORES < <(configured_stores | grep -v '^$' || true)
[ "${#STORES[@]}" -gt 0 ] || die "مفيش مخزن واحد إعداداته كاملة (R2_* أو B2_*)."

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_key="daily/hypertech-${stamp}.dump.age"
manifest_key="daily/hypertech-${stamp}.manifest.json"

log "▶ عدّ الصفوف قبل النسخ"
"$PG_BIN/psql" "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL" > "$work/before.json"
log "▶ pg_dump (إصدار الأداة $("$PG_BIN/pg_dump" --version | awk '{print $3}'))"
"$PG_BIN/pg_dump" --format=custom --compress=6 --no-owner --no-privileges --file="$work/db.dump" "$DB_URL"
"$PG_BIN/psql" "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL" > "$work/after.json"

log "▶ تشفير (age) وحذف النسخة غير المشفّرة فورًا"
age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$work/db.dump.age" "$work/db.dump"
shred -u "$work/db.dump" 2>/dev/null || rm -f "$work/db.dump"
sha="$(sha256sum "$work/db.dump.age" | cut -d' ' -f1)"
size="$(stat -c%s "$work/db.dump.age")"
migration="$("$PG_BIN/psql" "$DB_URL" -At -c "SELECT coalesce(max(filename), '') FROM _migrations_applied" 2>/dev/null || true)"
server="$("$PG_BIN/psql" "$DB_URL" -At -c "SHOW server_version")"

WORK="$work" STARTED="$started" KEY="$dump_key" SHA="$sha" SIZE="$size" MIGRATION="$migration" SERVER="$server" node -e '
const fs=require("fs");const w=process.env.WORK;
const before=JSON.parse(fs.readFileSync(w+"/before.json","utf8")),after=JSON.parse(fs.readFileSync(w+"/after.json","utf8"));
fs.writeFileSync(w+"/manifest.json",JSON.stringify({version:1,createdAt:process.env.STARTED,objectKey:process.env.KEY,sha256:process.env.SHA,sizeBytes:Number(process.env.SIZE),latestMigration:process.env.MIGRATION,serverVersion:process.env.SERVER,countsBefore:before,countsAfter:after},null,2));
fs.writeFileSync(w+"/counts.json",JSON.stringify(after));'

# كل مخزن بيتنفّذ في عملية bash منفصلة (upload-store.sh) عشان set -e يشتغل جواه فعلًا؛
# جوه if/|| بتتعطّل set -e وأي فشل وسطي كان هيعدّي صامت.
export WORK="$work" DUMP_KEY="$dump_key" MANIFEST_KEY="$manifest_key" SIZE="$size"
failed=0
for store in "${STORES[@]}"; do
  log "▶ رفع إلى ${store}"
  if bash scripts/backup/upload-store.sh "$store" 2> "$work/err-${store}.txt"; then
    record_run backup ok "$store" "$dump_key" "$size" "$sha" "$work/counts.json" ""
    log "✔ ${store}: تمام (${size} بايت)"
  else
    failed=1
    err="$(tail -c 500 "$work/err-${store}.txt" | tr '\n' ' ')"
    log "✖ ${store}: فشل — ${err}"
    record_run backup failed "$store" "$dump_key" "$size" "$sha" "" "$err"
  fi
done
[ "$failed" = 0 ] || die "فشل الرفع على مخزن واحد على الأقل."
log "✔ النسخة الاحتياطية كاملة: $dump_key"
