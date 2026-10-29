#!/usr/bin/env bash
# استرجاع آخر نسخة من مخزن واحد ($1 = r2 | b2) في قاعدة مؤقتة ومقارنة الصفوف. بيتنادى من restore-test.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/backup/common.sh
use_store "$1"

key="$(list_dump_keys | sort | tail -1)"
[ -n "$key" ] || { log "مفيش أي نسخة في المخزن"; exit 1; }
printf '%s\n' "$key" > "$WORK/key-$1.txt"
log "آخر نسخة في $1: $key"
s3 s3 cp "s3://${S3_BUCKET}/${key}" "$WORK/db.dump.age" --only-show-errors
s3 s3 cp "s3://${S3_BUCKET}/${key%.dump.age}.manifest.json" "$WORK/manifest.json" --only-show-errors

# بصمة وحجم الملف لازم يطابقوا اللي اتسجّل وقت النسخ (بيمسك أي تلف أو تعديل على المخزن)
node -e '
  const fs = require("fs"), c = require("crypto");
  const m = JSON.parse(fs.readFileSync(process.argv[1] + "/manifest.json", "utf8"));
  const b = fs.readFileSync(process.argv[1] + "/db.dump.age");
  if (b.length !== m.sizeBytes) { console.error("الحجم مختلف عن المسجّل"); process.exit(1); }
  if (c.createHash("sha256").update(b).digest("hex") !== m.sha256) { console.error("البصمة (sha256) مختلفة: الملف اتغيّر أو اتلف"); process.exit(1); }
' "$WORK"

age -d -i "$WORK/key.txt" -o "$WORK/db.dump" "$WORK/db.dump.age"
"$PG_BIN/psql" "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check"
# تحذيرات pg_restore بتتسجّل وبتتعرض؛ الحكم بمقارنة الصفوف
"$PG_BIN/pg_restore" --no-owner --no-privileges --dbname="$TARGET" "$WORK/db.dump" 2> "$WORK/restore.log" || true
"$PG_BIN/psql" "$TARGET" -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL" > "$WORK/restored.json"
npx --no-install tsx scripts/backup/compare-counts.ts "$WORK/manifest.json" "$WORK/restored.json" "$1" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

mig="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).latestMigration || "")' "$WORK/manifest.json")"
if [ -n "$mig" ]; then
  # اسم الملف جاي من manifest بتاعنا، ومع كده بنتأكد إنه حروف وأرقام ونقطة وشرطة قبل ما نحطه في SQL
  printf '%s' "$mig" | grep -Eq '^[0-9A-Za-z_.-]+$' || { log "اسم آخر تحديث هيكل في manifest غير صالح"; exit 1; }
  "$PG_BIN/psql" "$TARGET" -At -c "SELECT 1 FROM _migrations_applied WHERE filename = '$mig'" | grep -q 1 \
    || { log "آخر تحديث هيكل ($mig) مش موجود في القاعدة المسترجعة"; exit 1; }
fi
errs="$(grep -c 'error:' "$WORK/restore.log" || true)"
[ "${errs:-0}" = 0 ] || log "pg_restore سجّل ${errs} تحذير؛ الحكم النهائي بمقارنة الصفوف."
