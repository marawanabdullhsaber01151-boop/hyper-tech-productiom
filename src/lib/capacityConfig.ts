/** @format */
// إعدادات السعة الفعلية (43ب): سقف التحميل، تقويم العمل (إجازة أسبوعية + تانية + عطلات). بتتقرا من القاعدة كل مرة، فأي تغيير بيبان فورًا.
import { gte } from "drizzle-orm";
import { db, workHolidaysTable } from "../db";
import { loadSettingValues } from "./settingsStore";
import { CAPACITY_CAP, DEFAULT_CALENDAR, calendarFrom, todayCairo, type WorkCalendar } from "./operationsCapacityCore";

export interface CapacityConfig {
  cap: number;
  calendar: WorkCalendar;
  holidaysAhead: number;
  /** نسبة الثقة في الوعد (0.5–0.99) وتذبذب المدة (0–1) */
  confidence: number;
  variability: number;
}

/** لو القراءة فشلت بنرجع للافتراضي (85% والجمعة) بدل ما نوقف شاشة السعة. */
export async function loadCapacityConfig(now: Date): Promise<CapacityConfig> {
  try {
    const [values, holidays] = await Promise.all([
      loadSettingValues(),
      db.select({ d: workHolidaysTable.holidayDate }).from(workHolidaysTable).where(gte(workHolidaysTable.holidayDate, todayCairo(now))),
    ]);
    return {
      cap: Number(values["capacity.cap_percent"]) / 100,
      calendar: calendarFrom({ offDay: Number(values["work.off_day"]), offDay2: values["work.off_day_2"] ?? "none", holidays: holidays.map((h) => h.d) }),
      holidaysAhead: holidays.length,
      confidence: Number(values["promise.confidence_percent"]) / 100,
      variability: Number(values["promise.variability_percent"]) / 100,
    };
  } catch {
    return { cap: CAPACITY_CAP, calendar: DEFAULT_CALENDAR, holidaysAhead: 0, confidence: 0.8, variability: 0.2 };
  }
}
