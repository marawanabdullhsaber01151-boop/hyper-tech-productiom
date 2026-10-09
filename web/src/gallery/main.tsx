import { render } from "preact";
import { useState } from "preact/hooks";
import { bootTheme, applyTheme, accentLabel, BRAND_PRESETS, readCachedTheme, type ThemeSettings } from "../design/theme-runtime";
import {
  Avatar, Banner, Button, Card, Checkbox, CodeInput, ConfirmDialog, CopyField, DataTable, Dialog, Drawer, EmptyState, Field,
  FilterBar, IconButton, InlineAlert, Input, Menu, Pagination, PasswordInput, PermissionMatrix, PhoneInput, Popover, ProgressBar,
  Radio, Section, Select, ShareLinkCard, Skeleton, StatusPill, Stat, StepWizard, Switch, Tabs, Textarea, Timeline, ToastProvider,
  Tooltip, useToast, type Column, type SortState,
} from "../design/components";
import { Building, Ellipsis, Moon, Pencil, Plus, Sun, Monitor, Trash, Users } from "../design/icons";
import { formatDate, formatMoney, formatNumber, formatRelative } from "../lib/format";
import "../design/components";
import "./gallery.css";

bootTheme();

interface Row { id: number; company: string; owner: string; orders: number; total: number; status: "active" | "pending" | "blocked"; last: string }
const ROWS: Row[] = [
  { id: 1, company: "النور للتجارة", owner: "محمد سمير", orders: 42, total: 183500, status: "active", last: "2026-10-08T09:10:00Z" },
  { id: 2, company: "الأمل للأدوات الصحية", owner: "هدى عادل", orders: 7, total: 24120.5, status: "pending", last: "2026-10-02T12:00:00Z" },
  { id: 3, company: "الفاروق للتوريدات", owner: "خالد فاروق", orders: 0, total: 0, status: "blocked", last: "2026-09-20T15:30:00Z" },
];
const TONE = { active: "success", pending: "warn", blocked: "danger" } as const;
const LABEL = { active: "شغّال", pending: "مستني", blocked: "واقف" } as const;

const COLS: Column<Row>[] = [
  { key: "company", header: "الشركة", mobile: "title", sortable: true, cell: (r) => <strong>{r.company}</strong> },
  { key: "owner", header: "المسؤول", cell: (r) => r.owner },
  { key: "orders", header: "الطلبات", numeric: true, sortable: true, cell: (r) => formatNumber(r.orders) },
  { key: "total", header: "الإجمالي", numeric: true, cell: (r) => formatMoney(r.total) },
  { key: "status", header: "الحالة", cell: (r) => <StatusPill tone={TONE[r.status]} pulse={r.status === "pending"}>{LABEL[r.status]}</StatusPill> },
  { key: "last", header: "آخر نشاط", mobile: "hide", cell: (r) => formatRelative(r.last, Date.parse("2026-10-09T10:00:00Z")) },
];

const GROUPS = [
  { id: "orders", label: "الطلبات", items: [{ key: "orders.view", label: "يشوف الطلبات" }, { key: "orders.create", label: "يعمل طلب" }, { key: "orders.cancel", label: "يلغي طلب", locked: true }] },
  { id: "team", label: "الفريق", items: [{ key: "team.view", label: "يشوف الفريق" }, { key: "team.manage", label: "يضيف ويعدّل الموظفين", hint: "للمديرين بس" }] },
];

function ToastButtons() {
  const push = useToast();
  return (
    <div class="ht-row">
      <Button variant="secondary" onClick={() => push({ tone: "success", message: "اتحفظ" })}>نجاح</Button>
      <Button variant="secondary" onClick={() => push({ tone: "info", message: "في طلب جديد من شركة النور" })}>معلومة</Button>
      <Button variant="secondary" onClick={() => push({ tone: "danger", message: "ماقدرناش نحفظ. جرّب تاني." })}>خطأ</Button>
    </div>
  );
}

function Gallery() {
  const [theme, setTheme] = useState<ThemeSettings>(() => applyTheme({}));
  const set = (p: Partial<ThemeSettings>) => setTheme(applyTheme(p));
  const [tab, setTab] = useState("a");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set(["orders.view", "team.view"]));
  const [step, setStep] = useState(0);
  const [sw, setSw] = useState(true);
  const [loadingTable, setLoadingTable] = useState(false);
  const rows = q ? ROWS.filter((r) => r.company.includes(q)) : ROWS;
  const bad = phone.length > 3 && !/^01[0125]\d{8}$/.test(phone.replace(/\D/g, ""));

  return (
    <ToastProvider>
      <main class="g-wrap">
        <header class="g-head">
          <div>
            <h1>معرض المكوّنات</h1>
            <p>كل مكوّن في النظام الجديد بكل حالاته. غيّر الثيم والكثافة واللون من فوق وشوف الفرق.</p>
          </div>
          <div class="g-ctl" role="toolbar" aria-label="إعدادات المعاينة">
            <div class="ht-themebar" role="group" aria-label="الوضع">
              {([["light", "فاتح", Sun], ["dark", "غامق", Moon], ["system", "الجهاز", Monitor]] as const).map(([m, l, I]) => (
                <button key={m} aria-pressed={theme.mode === m} onClick={() => set({ mode: m })}><I size={16} aria-hidden="true" />{l}</button>
              ))}
            </div>
            <div class="ht-themebar" role="group" aria-label="الكثافة">
              {([["cozy", "مريحة"], ["compact", "مضغوطة"]] as const).map(([d, l]) => (
                <button key={d} aria-pressed={theme.density === d} onClick={() => set({ density: d })}>{l}</button>
              ))}
            </div>
            <div class="ht-themebar" role="group" aria-label="النبرة">
              {([["warm", "دافئ"], ["cool", "بارد"]] as const).map(([d, l]) => (
                <button key={d} aria-pressed={theme.tone === d} onClick={() => set({ tone: d })}>{l}</button>
              ))}
            </div>
            <div class="g-swatches" role="group" aria-label="لون العلامة">
              {Object.entries(BRAND_PRESETS).map(([k, v]) => (
                <button key={k} class="g-sw" aria-label={accentLabel(k)} aria-pressed={theme.accent === k} style={{ "--sw": `oklch(0.55 ${v.c} ${v.h})` } as never} onClick={() => set({ accent: k })} />
              ))}
            </div>
          </div>
        </header>

        <Banner tone="info">ده مجرد معرض داخلي — مش جزء من الموقع للعملاء.</Banner>

        <Section title="الأزرار" description="أساسي واحد في الشاشة. الباقي ثانوي أو شفاف.">
          <div class="ht-row">
            <Button icon={Plus}>إضافة موظف</Button>
            <Button variant="secondary">تعديل</Button>
            <Button variant="ghost">إلغاء</Button>
            <Button variant="danger" icon={Trash}>امسح</Button>
            <Button loading>بيحفظ</Button>
            <Button disabled>مقفول</Button>
            <Button size="sm">صغير</Button>
            <Button size="lg">كبير</Button>
            <IconButton icon={Pencil} label="تعديل" />
            <IconButton icon={Trash} label="امسح" variant="danger" />
          </div>
        </Section>

        <Section title="الحقول" description="كل حقل ليه label ظاهر وخطأ مربوط بيه.">
          <div class="ht-grid">
            <Field label="اسم الشركة" required hint="زي ما هيظهر في الفواتير"><Input placeholder="النور للتجارة" /></Field>
            <Field label="رقم الموبايل" required error={bad ? "الرقم ده مش مظبوط. اكتب 11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015." : null} hint="رقم مصري، زي 01012345678"><PhoneInput value={phone} onChange={(raw) => setPhone(raw)} /></Field>
            <Field label="الباسورد" required><PasswordInput /></Field>
            <Field label="كود الشركة" hint="بتاخده من مسؤول شركتك"><CodeInput value={code} onChange={(f) => setCode(f)} /></Field>
            <Field label="المحافظة"><Select placeholder="اختار" options={[{ value: "cai", label: "القاهرة" }, { value: "gz", label: "الجيزة" }, { value: "alx", label: "الإسكندرية" }]} /></Field>
            <Field label="ملاحظات" optional><Textarea rows={3} /></Field>
            <Field label="مقفول" disabled><Input disabled value="مش متاح" /></Field>
            <Field label="فيه خطأ" error="الاسم مطلوب"><Input /></Field>
          </div>
          <div class="ht-grid g-mt">
            <div><Checkbox label="افتكرني على الجهاز ده" /><Checkbox label="مفعّل" checked /><Checkbox label="مقفول" disabled /></div>
            <div><Radio name="r" label="مباشر" hint="الموظف ينضم من غير موافقة" checked /><Radio name="r" label="بموافقة الرئيس" /></div>
            <Switch label="السماح بالانضمام بالكود" hint="لو اتقفل، الكود مش هيشتغل" checked={sw} onChange={setSw} />
          </div>
        </Section>

        <Section title="الأكواد والمشاركة" description="لوحة الاسم المعدنية: أي قيمة محتاجة تتنسخ.">
          <div class="ht-grid">
            <CopyField label="كود الشركة" value="HT-7K9M-2QXH" />
            <ShareLinkCard title="رابط الانضمام" url="https://hyper-tech.example/v2/join?c=HT-7K9M-2QXH" whatsappPhone="01055651409" whatsappText="انضم لشركتنا على Hyper-Tech" />
          </div>
        </Section>

        <Section title="الحالات والأرقام">
          <div class="ht-row g-mb">
            <StatusPill>مسودة</StatusPill><StatusPill tone="brand">جديد</StatusPill><StatusPill tone="success">شغّال</StatusPill>
            <StatusPill tone="warn" pulse>مستني</StatusPill><StatusPill tone="danger">اتلغى</StatusPill><StatusPill tone="info">قيد المراجعة</StatusPill>
            <Avatar name="محمد سمير" /><Avatar name="هدى عادل" size={48} /><Avatar name="خالد" size={28} />
          </div>
          <div class="ht-grid">
            <Stat label="طلبات النهارده" value={formatNumber(12)} hint="3 منهم مستنيين رد" tone="brand" />
            <Stat label="إجمالي الشهر" value={formatMoney(183500)} tone="success" />
            <Stat label="شركات مستنية تفعيل" value={formatNumber(4)} tone="warn" />
            <Stat label="طلبات ملغية" value={formatNumber(1)} tone="danger" />
          </div>
          <div class="g-mt"><ProgressBar label="اكتمال الطلب" value={64} /></div>
        </Section>

        <Section title="الجداول" description="على الموبايل بتتحوّل لكروت.">
          <FilterBar search={q} onSearch={setQ} searchLabel="دوّر على شركة" activeCount={q ? 1 : 0} onClear={() => setQ("")}>
            <Select aria-label="الحالة" placeholder="كل الحالات" options={[{ value: "active", label: "شغّال" }, { value: "pending", label: "مستني" }]} />
          </FilterBar>
          <DataTable caption="الشركات" columns={COLS} rows={rows} rowKey={(r) => r.id} sort={sort} onSort={setSort} loading={loadingTable}
            rowActions={() => <Menu label="إجراءات" trigger={({ toggle, open, id }) => <IconButton icon={Ellipsis} label="إجراءات" aria-expanded={open} aria-controls={id} onClick={toggle} />} items={[{ label: "عرض", onSelect: () => {} }, { label: "تعديل", icon: Pencil, onSelect: () => {} }, { label: "إيقاف", danger: true, onSelect: () => {} }]} />}
            empty={<EmptyState title="مفيش شركات لسه" description="أول ما شركة تسجّل هتظهر هنا." action={<Button icon={Plus}>إضافة شركة</Button>} />} />
          <Pagination page={page} pageSize={3} total={25} onPage={setPage} />
          <div class="ht-row g-mt"><Button variant="ghost" size="sm" onClick={() => { setLoadingTable(true); setTimeout(() => setLoadingTable(false), 1600); }}>جرّب حالة التحميل</Button></div>
          <div class="g-mt"><DataTable caption="فاضي" columns={COLS} rows={[]} rowKey={(r: Row) => r.id} /></div>
        </Section>

        <Section title="التنبيهات والإشعارات">
          <div class="ht-stack">
            <InlineAlert tone="info" title="معلومة">الكود بيفضل شغّال لحد ما تغيّره.</InlineAlert>
            <InlineAlert tone="success" title="اتحفظ">التعديلات اتسجلت.</InlineAlert>
            <InlineAlert tone="warn" title="انتبه">الشركة وصلت لأقصى عدد موظفين.</InlineAlert>
            <InlineAlert tone="danger" title="مشكلة" action={<Button size="sm" variant="secondary">جرّب تاني</Button>}>ماقدرناش نوصل للسيرفر.</InlineAlert>
            <ToastButtons />
          </div>
        </Section>

        <Section title="التبويبات والخطوات والتسلسل">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "a", label: "الفريق", badge: 3, panel: <p>قائمة الموظفين هنا.</p> }, { id: "b", label: "الصلاحيات", panel: <p>الأدوار والصلاحيات.</p> }, { id: "c", label: "النشاط", panel: <p>سجل النشاط.</p> }]} />
          <div class="g-mt ht-grid g-cols2">
            <Card><StepWizard current={step} onChange={setStep} onFinish={() => setStep(0)} steps={[{ id: "1", title: "الشركة", content: <Field label="كود الشركة"><CodeInput value={code} onChange={(f) => setCode(f)} /></Field> }, { id: "2", title: "بياناتك", content: <Field label="اسمك"><Input /></Field> }, { id: "3", title: "تأكيد", content: <p>راجع بياناتك وكمّل.</p> }]} /></Card>
            <Card><Timeline items={[{ id: 1, title: "الطلب اتعمل", meta: "النهارده 10:02 ص", tone: "brand" }, { id: 2, title: "اتأكد من الإدارة", meta: "النهارده 11:15 ص", body: "تم تأكيد المخزون.", tone: "success" }, { id: 3, title: "بيتجهّز", meta: "دلوقتي", tone: "warn" }]} /></Card>
          </div>
        </Section>

        <Section title="الصلاحيات">
          <PermissionMatrix groups={GROUPS} value={perms} onChange={setPerms} />
        </Section>

        <Section title="النوافذ">
          <div class="ht-row">
            <Button variant="secondary" onClick={() => setDialog(true)}>نافذة</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>قائمة جانبية</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>تأكيد مسح</Button>
            <Tooltip text="دي نصيحة سريعة"><Button variant="ghost" icon={Users}>مرّر عليّا</Button></Tooltip>
            <Popover label="تفاصيل" trigger={({ toggle, open, id }) => <Button variant="secondary" icon={Building} aria-expanded={open} aria-controls={id} onClick={toggle}>بوب أوفر</Button>}><p>محتوى صغير جنب الزر.</p></Popover>
          </div>
          <Dialog open={dialog} onClose={() => setDialog(false)} title="إضافة موظف" description="هنعمل له حساب ونديك الباسورد المؤقت." footer={<><Button variant="ghost" onClick={() => setDialog(false)}>إلغاء</Button><Button onClick={() => setDialog(false)}>اتحفظ</Button></>}>
            <div class="ht-stack"><Field label="الاسم" required><Input /></Field><Field label="الموبايل" required><PhoneInput value={phone} onChange={(r) => setPhone(r)} /></Field></div>
          </Dialog>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="تفاصيل الشركة"><Skeleton lines={4} /></Drawer>
          <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => setConfirm(false)} danger title="تمسح الموظف ده؟" description="مش هيقدر يدخل تاني، وطلباته القديمة هتفضل زي ما هي." confirmLabel="امسح" />
        </Section>

        <Section title="حالات فاضية وتحميل">
          <div class="ht-grid g-cols2">
            <Card><EmptyState title="مفيش طلبات لسه" description="أول طلب هتعمله هيظهر هنا." action={<Button icon={Plus}>اعمل طلب</Button>} /></Card>
            <Card><Skeleton height={20} width="40%" /><div class="g-mt"><Skeleton lines={3} /></div></Card>
          </div>
          <p class="g-mt">{formatDate("2026-10-09")}</p>
        </Section>
      </main>
    </ToastProvider>
  );
}

readCachedTheme();
render(<Gallery />, document.getElementById("app")!);
