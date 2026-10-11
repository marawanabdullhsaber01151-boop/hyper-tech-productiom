/** @format */
export type CustomerHealth = {
  level: "critical" | "new" | "warning" | "healthy";
  label: string;
  daysSinceLastOrder: number | null;
  creditUtilization: number | null;
};

export function customerHealth(
  balance: string | null,
  creditLimit: string | null,
  lastOrderAt: Date | null,
): CustomerHealth {
  const daysSinceLastOrder = lastOrderAt
    ? Math.max(0, Math.floor((Date.now() - lastOrderAt.getTime()) / 86_400_000))
    : null;
  const creditUtilization =
    creditLimit === null || Number(creditLimit) <= 0
      ? null
      : Number(balance || 0) / Number(creditLimit);

  if (creditUtilization !== null && creditUtilization >= 1) {
    return { level: "critical", label: "تجاوز الحد الائتماني", daysSinceLastOrder, creditUtilization };
  }
  if (daysSinceLastOrder === null) {
    return { level: "new", label: "لا توجد طلبات بعد", daysSinceLastOrder, creditUtilization };
  }
  if (creditUtilization !== null && creditUtilization >= 0.8) {
    return { level: "warning", label: "قريب من الحد الائتماني", daysSinceLastOrder, creditUtilization };
  }
  if (daysSinceLastOrder > 90) {
    return { level: "warning", label: "يحتاج متابعة", daysSinceLastOrder, creditUtilization };
  }
  return { level: "healthy", label: "مستقر", daysSinceLastOrder, creditUtilization };
}
