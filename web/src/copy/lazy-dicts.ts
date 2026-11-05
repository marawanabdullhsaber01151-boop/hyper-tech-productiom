/**
 * قائمة نصوص الصفحات المتحمّلة بالكسل. للفحص والاختبارات بس (check-copy.ts و test/setup.ts).
 * ممنوع أي ملف تطبيق يعمل لها import، وإلا النصوص دي كلها ترجع للحزمة الرئيسية. (check-copy بيمنع ده)
 */
import { salesCopy } from "./sales";
import { purchasesCopy } from "./purchases";
import { contactsCopy } from "./contacts";
import { operationsCopy } from "./operations";
import { productionCopy } from "./production";
import { engineeringCopy } from "./engineering";
import { invCopy } from "./inv";
import { planningCopy } from "./planning";
import { foundationCopy } from "./foundation";
import { receivingCopy } from "./receiving";
import { activityCopy } from "./activity";
import { approvalsCopy } from "./approvals";
import { approvalsAdminCopy } from "./approvalsAdmin";
import { settingsCopy } from "./settings";

export const lazyCopies = {
  sales: salesCopy,
  purchases: purchasesCopy,
  contacts: contactsCopy,
  operations: operationsCopy,
  production: productionCopy,
  engineering: engineeringCopy,
  inv: invCopy,
  planning: planningCopy,
  foundation: foundationCopy,
  receiving: receivingCopy,
  activity: activityCopy,
  approvals: approvalsCopy,
  approvalsAdmin: approvalsAdminCopy,
  settings: settingsCopy,
} as const;
