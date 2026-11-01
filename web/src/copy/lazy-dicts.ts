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

export const lazyCopies = {
  sales: salesCopy,
  purchases: purchasesCopy,
  contacts: contactsCopy,
  operations: operationsCopy,
  production: productionCopy,
  engineering: engineeringCopy,
  inv: invCopy,
} as const;
