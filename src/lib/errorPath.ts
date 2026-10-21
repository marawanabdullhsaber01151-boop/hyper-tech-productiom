/** @format */

/** يشيل أرقام المعرّفات الطويلة من المسار عشان الأخطاء المتشابهة تتجمّع (/sales/123 ← /sales/:id). */
export function normalizePath(path: string): string {
  const clean = path.split("?")[0] ?? "";
  return clean
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .slice(0, 200);
}
