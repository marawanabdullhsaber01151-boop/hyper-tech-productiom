// دليل النظام (م3): فهرس الشاشات والأزرار. «src» مفتاح النص الحقيقي (بصيغة «بادئة:باقي المفتاح» عشان فاحص النصوص ما يعتبرهوش استخدام) للزرار في الواجهة؛ اختبار الانحدار بيقارن اسم الزرار في الدليل بالنص الحقيقي،
// فلو اتغيّر اسم زرار من غير تحديث الدليل الاختبار يقع. النصوص نفسها في copy/guide3.ts.

export interface ScreenButton { id: string; src: string }
export interface ScreenDef {
  id: string;
  /** معرّفات صفحات القايمة (DEPARTMENTS) اللي بتفتح الشاشة دي. فاضي = شاشة العميل أو شاشة مش في القايمة. */
  pages: readonly string[];
  /** staff = للموظفين، portal = شاشات العميل على البوابة. */
  side: "staff" | "portal";
  buttons: readonly ScreenButton[];
}

export const SCREENS: readonly ScreenDef[] = [
  { id: "sales", side: "staff", pages: ["sales-online", "sales-offline"], buttons: [
    { id: "new", src: "sales:new" }, { id: "export", src: "sales:export" }, { id: "edit", src: "sales:act.edit" },
    { id: "delete", src: "sales:act.delete" }, { id: "print", src: "sales:act.print" }, { id: "addStock", src: "sales:ed.add.stock" },
    { id: "addManual", src: "sales:ed.add.manual" }, { id: "save", src: "sales:ed.save" },
  ] },
  { id: "quotes", side: "staff", pages: ["quotes", "quotes-offline"], buttons: [
    { id: "new", src: "qt:new" }, { id: "addLine", src: "qt:form.addLine" }, { id: "draft", src: "qt:form.saveDraft" },
    { id: "send", src: "qt:d.send" }, { id: "cancel", src: "qt:d.cancel" }, { id: "edit", src: "qt:d.edit" },
  ] },
  { id: "contacts", side: "staff", pages: ["contacts"], buttons: [
    { id: "new", src: "con:new" }, { id: "import", src: "con:import" }, { id: "export", src: "con:export" },
    { id: "edit", src: "con:edit" }, { id: "dup", src: "con:dup.confirm" },
  ] },
  { id: "preq", side: "staff", pages: ["production-requests", "production-requests-warehouse"], buttons: [
    { id: "new", src: "prd:req.new" }, { id: "approve", src: "prd:dec.a.approve" }, { id: "reject", src: "prd:dec.a.reject" }, { id: "cancel", src: "prd:act.cancel" },
  ] },
  { id: "porders", side: "staff", pages: ["production", "factory-warehouse-manager"], buttons: [
    { id: "new", src: "prd:ord.new" }, { id: "receive", src: "prd:ord.act.receive" }, { id: "decide", src: "prd:ord.act.decide" },
    { id: "dispatch", src: "prd:ord.x.send" }, { id: "advance", src: "prd:ord.a.send" }, { id: "hold", src: "prd:ord.h.send" },
    { id: "resume", src: "prd:ord.s.send" }, { id: "rework", src: "prd:ord.w.send" }, { id: "partial", src: "prd:ord.p.send" },
    { id: "confirm", src: "prd:ord.act.confirm" }, { id: "cancel", src: "prd:ord.act.cancel" },
  ] },
  { id: "pexec", side: "staff", pages: ["production-control", "execution-control"], buttons: [
    { id: "batch", src: "prd:ex.newBatch" }, { id: "confirm", src: "prd:ex.confirm" }, { id: "close", src: "prd:ex.close" },
    { id: "stop", src: "prd:oee.start" }, { id: "ncr", src: "prd:q.new" }, { id: "ncrClose", src: "prd:q.close" },
  ] },
  { id: "inspect", side: "staff", pages: ["factory-quality-controller"], buttons: [{ id: "start", src: "prd:insp.start" }] },
  { id: "stock", side: "staff", pages: ["inventory", "material", "movements", "stock-view"], buttons: [
    { id: "new", src: "inv:new" }, { id: "move", src: "inv:move.save" }, { id: "count", src: "inv:count.save" },
    { id: "export", src: "inv:mv.export" }, { id: "print", src: "inv:act.print" },
  ] },
  { id: "purchases", side: "staff", pages: ["purchases", "purchases-receive"], buttons: [
    { id: "new", src: "po:new" }, { id: "submit", src: "po:act.submit" }, { id: "approve", src: "po:act.approve" },
    { id: "reject", src: "po:act.reject" }, { id: "send", src: "po:act.send" }, { id: "cancel", src: "po:act.cancel" },
    { id: "receive", src: "po:act.receive" }, { id: "receiveSave", src: "po:rc.save" },
  ] },
  { id: "receiving", side: "staff", pages: ["raw-material-inspection"], buttons: [{ id: "inspect", src: "rcv:inspect" }, { id: "save", src: "rcv:dlg.save" }] },
  { id: "approvals", side: "staff", pages: ["approvals"], buttons: [
    { id: "approve", src: "apv:dlg.approve" }, { id: "reject", src: "apv:dlg.reject" }, { id: "polAdd", src: "apa:pol.add" },
    { id: "delAdd", src: "apa:del.add" }, { id: "sim", src: "apa:sim.run" }, { id: "verify", src: "apa:sec.verify.run" },
  ] },
  { id: "ledger", side: "staff", pages: ["ledger"], buttons: [
    { id: "entry", src: "lg:e.new" }, { id: "post", src: "lg:f.post" }, { id: "reverse", src: "lg:d.reverse" },
    { id: "account", src: "lg:a.new" }, { id: "stop", src: "lg:a.stop" }, { id: "collect", src: "lg:c.new" },
    { id: "void", src: "lg:c.void" }, { id: "print", src: "lg:r.print" }, { id: "limit", src: "lg:r.cr.set" },
    { id: "autoOn", src: "lg:x.start" }, { id: "autoOff", src: "lg:x.stop" },
    { id: "xfConfirm", src: "tr:st.confirm" }, { id: "xfReject", src: "tr:st.reject" },
    { id: "bcNew", src: "bc:st.new" }, { id: "bcResolve", src: "bc:st.resolve" }, { id: "bcCancel", src: "bc:st.cancel" },
    { id: "pcClose", src: "pc:close" }, { id: "pcReopen", src: "pc:reopen" },
  ] },
  { id: "engineering", side: "staff", pages: ["engineering"], buttons: [
    { id: "product", src: "eng:p.new" }, { id: "version", src: "eng:v.new" }, { id: "approve", src: "eng:a.approve" },
    { id: "release", src: "eng:a.release" }, { id: "change", src: "eng:ch.new" }, { id: "recipe", src: "rcp:new" }, { id: "activate", src: "rcp:d.activate" },
  ] },
  { id: "planning", side: "staff", pages: ["planning"], buttons: [
    { id: "new", src: "pln:tab.new" }, { id: "save", src: "pln:save" }, { id: "approve", src: "pln:d.approve" }, { id: "release", src: "pln:d.release" },
  ] },
  { id: "operations", side: "staff", pages: ["operations-center"], buttons: [
    { id: "intake", src: "opc:intake.btn" }, { id: "clarify", src: "opc:clarify.btn" }, { id: "claim", src: "opc:claim.btn" },
    { id: "plan", src: "opc:plan.run" }, { id: "planSave", src: "opc:plan.save" }, { id: "transfer", src: "opc:tr.new" },
    { id: "cost", src: "opc:co.add" }, { id: "promise", src: "opc:pr.run" },
  ] },
  { id: "foundation", side: "staff", pages: ["foundation"], buttons: [
    { id: "item", src: "fnd:it.new" }, { id: "import", src: "fnd:it.import" }, { id: "export", src: "fnd:it.export" },
    { id: "approve", src: "fnd:it.approve" }, { id: "reject", src: "fnd:it.reject" },
  ] },
  { id: "settings", side: "staff", pages: ["settings"], buttons: [
    { id: "tfa", src: "acc:tfa.start" }, { id: "pw", src: "acc:pw.save" },
  ] },
  { id: "tasks", side: "staff", pages: [], buttons: [
    { id: "new", src: "tasks:new" }, { id: "claim", src: "tasks:act.claim" }, { id: "done", src: "tasks:complete.confirm" }, { id: "cancel", src: "tasks:cancel.confirm" },
  ] },
  { id: "reports", side: "staff", pages: ["reports"], buttons: [{ id: "run", src: "rep:run" }, { id: "print", src: "rep:print" }] },
  { id: "health", side: "staff", pages: ["system-health"], buttons: [{ id: "all", src: "staff:health.all" }] },
  { id: "activity", side: "staff", pages: ["activity"], buttons: [{ id: "views", src: "act:views" }] },
  { id: "portalAdmin", side: "staff", pages: ["portal-orders", "portal-customers-admin", "portal-applications-admin", "portal-activation-requests-admin"], buttons: [
    { id: "apApprove", src: "a:ap.act.approve" }, { id: "apReject", src: "a:ap.act.reject" }, { id: "acConfirm", src: "a:ac.confirm.go" },
    { id: "acClose", src: "a:ac.d.close" }, { id: "poConfirm", src: "a:po.d.confirm" }, { id: "poReject", src: "a:po.d.reject" },
    { id: "poClaim", src: "a:po.d.claim" }, { id: "archive", src: "a:ov.archive" }, { id: "teamAdd", src: "a:team.add" },
  ] },
  { id: "chat", side: "staff", pages: ["chat-staff"], buttons: [
    { id: "claim", src: "c:a.claim" }, { id: "close", src: "c:a.close" }, { id: "reopen", src: "c:a.reopen" },
  ] },
  { id: "pLogin", side: "portal", pages: [], buttons: [{ id: "login", src: "p:login.submit" }, { id: "apply", src: "p:login.apply" }, { id: "applySend", src: "p:apply.send" }] },
  { id: "pShop", side: "portal", pages: [], buttons: [{ id: "add", src: "p:products.add" }, { id: "send", src: "p:cart.send" }, { id: "cancel", src: "p:orders.cancel" }, { id: "decline", src: "p:qt.decline" }] },
  { id: "pPay", side: "portal", pages: [], buttons: [{ id: "report", src: "tr:p.new" }] },
  { id: "pBal", side: "portal", pages: [], buttons: [{ id: "agree", src: "bc:p.agree" }, { id: "dispute", src: "bc:p.dispute" }] },
  { id: "pTeam", side: "portal", pages: [], buttons: [{ id: "add", src: "p:team.add" }, { id: "accept", src: "p:team.req.approve" }, { id: "refuse", src: "p:team.req.reject" }, { id: "remove", src: "p:team.remove" }] },
];

/** مصطلحات القاموس (نصوص guide.gl.<id>.t/.d). */
export const GLOSSARY = ["nc", "bom", "mrp", "oee", "advance", "aging", "reserve", "reversal", "sla", "delegate", "batch", "poReceipt", "creditLimit", "archive", "audit"] as const;
/** سيناريوهات «لو حصل كذا اعمل كذا» (نصوص guide.sn.<id>.t/.s1..sN). */
export const SCENARIOS = [
  { id: "overLimit", steps: 4 },
  { id: "badDelivery", steps: 4 },
  { id: "wrongEntry", steps: 3 },
  { id: "stuckApproval", steps: 3 },
  { id: "customerPaid", steps: 4 },
] as const;
