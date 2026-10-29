#!/usr/bin/env bash
# دوال مشتركة لسكربتات النسخ الاحتياطي واختبار الاسترجاع. بتتحمّل بـ: source scripts/backup/common.sh
# أي سر بييجي من متغيرات البيئة (GitHub Secrets)، ومفيش حاجة منهم بتتطبع.

PG_MAJOR="${PG_MAJOR:-17}"
PG_BIN="/usr/lib/postgresql/${PG_MAJOR}/bin"
[ -x "$PG_BIN/pg_dump" ] || PG_BIN="$(dirname "$(command -v pg_dump)")"

# عدّ الصفوف الدقيق لكل جداول public كـ JSON: {"table": n, ...}
COUNTS_SQL="SELECT coalesce(json_object_agg(table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint), '{}'::json) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"

log() { printf '%s\n' "$*" >&2; }
die() { log "✖ $*"; exit 1; }

# المخازن اللي إعداداتها كاملة (r2 / b2). مخزن ناقص إعداداته بيتجاهل بصمت بس مع تحذير.
configured_stores() {
  local s p out=()
  for s in r2 b2; do
    p=$(printf '%s' "$s" | tr '[:lower:]' '[:upper:]')
    local a="${p}_ACCESS_KEY_ID" b="${p}_SECRET_ACCESS_KEY" c="${p}_ENDPOINT" d="${p}_BUCKET"
    if [ -n "${!a:-}" ] && [ -n "${!b:-}" ] && [ -n "${!c:-}" ] && [ -n "${!d:-}" ]; then
      out+=("$s")
    elif [ -n "${!a:-}${!b:-}${!c:-}${!d:-}" ]; then
      log "⚠ إعدادات ${p} ناقصة (لازم ${a} و${b} و${c} و${d}) — اتجاهل."
    fi
  done
  printf '%s\n' "${out[@]:-}"
}

# يجهّز متغيرات aws لمخزن واحد: AWS_* و S3_ENDPOINT و S3_BUCKET
use_store() {
  local p; p=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  local a="${p}_ACCESS_KEY_ID" b="${p}_SECRET_ACCESS_KEY" c="${p}_ENDPOINT" d="${p}_BUCKET"
  export AWS_ACCESS_KEY_ID="${!a}" AWS_SECRET_ACCESS_KEY="${!b}" S3_BUCKET="${!d}"
  local ep="${!c}"
  case "$ep" in http://*|https://*) ;; *) ep="https://$ep" ;; esac
  export S3_ENDPOINT="$ep"
  # R2 بيستخدم region=auto. Backblaze region بتتاخد من العنوان: s3.<region>.backblazeb2.com
  if [ "$1" = "r2" ]; then export AWS_DEFAULT_REGION=auto
  else export AWS_DEFAULT_REGION="$(printf '%s' "$ep" | sed -E 's#^https?://s3\.([^.]+)\.backblazeb2\.com.*#\1#')"; fi
  # aws-cli الحديث بيضيف checksum headers مش كل المخازن المتوافقة بتقبلها.
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
}

s3() { aws "$@" --endpoint-url "$S3_ENDPOINT"; }

# كل مفاتيح النسخ (daily/hypertech-*.dump.age) في المخزن الحالي، مفتاح في كل سطر
list_dump_keys() {
  s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "daily/hypertech-" --query 'Contents[].Key' --output text \
    | tr '\t' '\n' | grep -E '^daily/hypertech-[0-9]{8}T[0-9]{6}Z\.dump\.age$' || true
}

db_url() { printf '%s' "${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"; }

# تسجيل تشغيلة في جدول backup_runs (لو فشل التسجيل ما بنوقّفش النسخة)
record_run() {
  RUN_KIND="$1" RUN_STATUS="$2" RUN_STORE="$3" RUN_OBJECT_KEY="${4:-}" RUN_SIZE="${5:-}" RUN_SHA256="${6:-}" RUN_COUNTS_FILE="${7:-}" RUN_ERROR="${8:-}" \
    npx --no-install tsx scripts/backup/record-run.ts || log "⚠ ما قدرتش أسجّل التشغيلة في backup_runs (هل هجرة 0084 اتطبّقت؟)"
}
