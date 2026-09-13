/**
 * سكريبت تشخيصي — بيقولك بالظبط فين المشكلة في تسجيل الدخول.
 *
 * الاستخدام:
 *   DATABASE_URL="نفس رابط قاعدة البيانات المستخدم في Vercel بالظبط" \
 *   node diagnose-login.mjs admin "الباسورد اللي بتكتبه"
 *
 * لازم تشغّله من جوه فولدر المشروع بعد ما تعمل npm install.
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const [, , username, passwordToTest] = process.argv;

if (!username || !passwordToTest) {
  console.error('الاستخدام: node diagnose-login.mjs <username> <password>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ لازم تحدد DATABASE_URL قبل تشغيل السكريبت (نفس اللي في Vercel بالظبط).");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

console.log("🔎 هبحث في القاعدة دي:");
try {
  const url = new URL(process.env.DATABASE_URL);
  console.log(`   Host: ${url.hostname}`);
  console.log(`   DB:   ${url.pathname.replace("/", "")}`);
} catch {
  console.log("   (تعذّر تحليل الرابط)");
}
console.log("");

const { rows } = await pool.query(
  'SELECT id, username, password_hash, status FROM system_users WHERE username = $1',
  [username],
);

if (rows.length === 0) {
  console.log(`❌ مفيش أي مستخدم باسم "${username}" في الجدول system_users في القاعدة دي.`);
  console.log('   ➜ ده معناه إنك واصل لقاعدة بيانات مختلفة عن اللي فيرسال بيستخدمها،');
  console.log('     أو الجدول لسه فاضي وميعملوش seed خالص على القاعدة دي.');
  await pool.end();
  process.exit(0);
}

const user = rows[0];
console.log(`✓ لقيت المستخدم: id=${user.id}, username=${user.username}, status=${user.status}`);
console.log(`  password_hash المخزّن حاليًا: ${user.password_hash}`);
console.log("");

if (!user.password_hash || !user.password_hash.startsWith("$2")) {
  console.log("❌ الـ hash المخزّن شكله مش صح (مفروض يبدأ بـ $2a$ أو $2b$).");
  console.log("   ➜ يبقى الـ UPDATE اللي عملته فشل أو اتقطع أو اتلزق غلط.");
  await pool.end();
  process.exit(0);
}

const matches = await bcrypt.compare(passwordToTest, user.password_hash);

if (matches) {
  console.log("✅ الباسورد ده صحيح 100% ومطابق للـ hash المخزّن في القاعدة دي.");
  console.log("   لو برضو بيرفض في الموقع، المشكلة مش في القاعدة أو الباسورد —");
  console.log("   يبقى فيرسال شغّال متصل بقاعدة بيانات تانية (DATABASE_URL مختلف)،");
  console.log("   أو فيه مشكلة في الفرونت إند بيبعت البيانات غلط.");
} else {
  console.log("❌ الباسورد ده مش مطابق للـ hash المخزّن في القاعدة دي.");
  console.log("   ➜ يبقى الـ UPDATE اتنفذ على قاعدة تانية، أو الـ hash اتلزق فيه خطأ،");
  console.log("     أو فيه حروف زيادة (مسافة/سطر جديد) اتلصقت بالغلط.");
}

if (user.status !== "active") {
  console.log("");
  console.log(`⚠️ تنبيه إضافي: حالة الحساب "${user.status}" مش "active" — ده هيمنع الدخول حتى لو الباسورد صح.`);
}

await pool.end();
