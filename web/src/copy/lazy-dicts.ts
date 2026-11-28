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
import { reportsCopy } from "./reports";
import { settingsCopy } from "./settings";
import { quotesCopy } from "./quotes";
import { viewAsCopy } from "./viewas";
import { ledgerCopy } from "./ledger";
import { guideCopy } from "./guide";
import { guide2Copy } from "./guide2";
import { guide3Copy } from "./guide3";
import { guide4Copy } from "./guide4";
import { guide5Copy } from "./guide5";
import { guide6Copy } from "./guide6";
import { guide7Copy } from "./guide7";
import { portalGuideCopy } from "./portalGuide";
import { transfersCopy } from "./transfers";
import { balancesCopy } from "./balances";
import { periodsCopy } from "./periods";
import { eInvoiceCopy } from "./eInvoice";
import { warehousesCopy } from "./warehouses";
import { costingCopy } from "./costing";

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
  reports: reportsCopy,
  quotes: quotesCopy,
  viewas: viewAsCopy,
  ledger: ledgerCopy,
  guide: guideCopy,
  guide2: guide2Copy,
  guide3: guide3Copy,
  guide4: guide4Copy,
  guide5: guide5Copy,
  guide6: guide6Copy,
  guide7: guide7Copy,
  portalGuide: portalGuideCopy,
  transfers: transfersCopy,
  balances: balancesCopy,
  periods: periodsCopy,
  eInvoice: eInvoiceCopy,
  warehouses: warehousesCopy,
  costing: costingCopy,
} as const;
