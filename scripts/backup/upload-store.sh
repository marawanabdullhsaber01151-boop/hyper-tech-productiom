#!/usr/bin/env bash
# رفع نسخة واحدة لمخزن واحد: $1 = r2 | b2. بيتنادى من backup.sh بمتغيرات WORK و DUMP_KEY و MANIFEST_KEY و SIZE.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/backup/common.sh
use_store "$1"

s3 s3 cp "$WORK/db.dump.age" "s3://${S3_BUCKET}/${DUMP_KEY}" --only-show-errors
s3 s3 cp "$WORK/manifest.json" "s3://${S3_BUCKET}/${MANIFEST_KEY}" --only-show-errors
remote="$(s3 s3api head-object --bucket "$S3_BUCKET" --key "$DUMP_KEY" --query ContentLength --output text)"
[ "$remote" = "$SIZE" ] || { log "الحجم على المخزن ($remote) غير مطابق للمحلي ($SIZE)"; exit 1; }

# تنظيف القديم بسياسة الاحتفاظ (14 يوم + أحاد 8 أسابيع + أول الشهر 12 شهر + آخر 3 دايمًا)
list_dump_keys | npx --no-install tsx scripts/backup/prune.ts > "$WORK/prune-$1.txt"
while IFS= read -r old; do
  [ -n "$old" ] || continue
  s3 s3api delete-object --bucket "$S3_BUCKET" --key "$old" > /dev/null
  s3 s3api delete-object --bucket "$S3_BUCKET" --key "${old%.dump.age}.manifest.json" > /dev/null
  log "اتمسحت نسخة قديمة: $old"
done < "$WORK/prune-$1.txt"
