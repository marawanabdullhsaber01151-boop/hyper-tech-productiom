/** ترتيب وإخفاء كروت اللوحة لكل مستخدم (الخطوة 41ب). دوال نقية، مغطّاة باختبارات. نفس قايمة الكروت في السيرفر. */
export const CARD_IDS = ["kpis", "status", "alerts", "orders", "categories", "summary"] as const;
export type CardId = (typeof CARD_IDS)[number];
export interface Layout { order: CardId[]; hidden: CardId[] }
export const DEFAULT_LAYOUT: Layout = { order: [...CARD_IDS], hidden: [] };

const known = (v: unknown): v is CardId => typeof v === "string" && (CARD_IDS as readonly string[]).includes(v);
const uniq = (v: unknown): CardId[] => {
  const out: CardId[] = [];
  if (Array.isArray(v)) for (const x of v) if (known(x) && !out.includes(x)) out.push(x);
  return out;
};
/** أي قيمة جاية من السيرفر تتنضّف: كروت معروفة بس والناقص بيتضاف في الآخر (كارت جديد بعد تحديث ما يختفيش). */
export function normalizeLayout(raw: unknown): Layout {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const order = uniq(o.order);
  for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
  return { order, hidden: uniq(o.hidden) };
}

/** الكروت اللي تتعرض فعلًا: بالترتيب المحفوظ، من غير المخفي، ومن غير اللي المستخدم مالوش صلاحية بياناتها. */
export function visibleCards(layout: Layout, available: ReadonlySet<CardId>): CardId[] {
  return layout.order.filter((id) => available.has(id) && !layout.hidden.includes(id));
}
/** الكروت اللي تظهر في شاشة التخصيص (المتاحة له بس، مخفية أو لا). */
export const customizableCards = (layout: Layout, available: ReadonlySet<CardId>): CardId[] => layout.order.filter((id) => available.has(id));

/** تحريك كارت خطوة لفوق/تحت بين الكروت المتاحة فقط (من غير ما نبوّظ مكان الكروت اللي مش ظاهرة له). */
export function moveCard(layout: Layout, id: CardId, dir: -1 | 1, available: ReadonlySet<CardId>): Layout {
  const shown = customizableCards(layout, available);
  const i = shown.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return layout;
  const other = shown[j] as CardId;
  const order = [...layout.order];
  const a = order.indexOf(id); const b = order.indexOf(other);
  order[a] = other; order[b] = id;
  return { order, hidden: layout.hidden };
}
export function toggleCard(layout: Layout, id: CardId): Layout {
  return { order: layout.order, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] };
}
export const isDefaultLayout = (l: Layout) => l.hidden.length === 0 && l.order.every((id, i) => id === CARD_IDS[i]);
