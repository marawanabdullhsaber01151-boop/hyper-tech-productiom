/** قراءة نص CSV أو الملصوق من Excel (الفاصل تاب) لجدول خلايا. نقي من أي واجهة. */

export type Delimiter = "," | ";" | "\t";

/** الفاصل من أول سطر: تاب (لصق من Excel) ثم ; ثم , (الأكتر تكرارًا برّه الاقتباس). */
export function detectDelimiter(text: string): Delimiter {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  let inQ = false;
  const n: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === "," || ch === ";" || ch === "\t")) n[ch]++;
  }
  if (n["\t"] > 0) return "\t";
  return n[";"] > n[","] ? ";" : ",";
}

export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") inQ = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (src[i + 1] !== "\n") endRow(); }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type RowStatus = "new" | "invalid" | "file_duplicate" | "exists" | "similar";
export interface PreviewRow {
  line: number;
  row: { name: string; company: string; phone: string; email: string; address: string; city: string; notes: string };
  issues: string[];
  status: RowStatus;
  duplicateOfLine: number | null;
  matches: Array<{ id: number; name: string; company: string | null; phone: string | null; reason: string }>;
}

/** عدد اللي هيتحفظ فعليًا: الجديد + المتشابه المعلّم. */
export function willCreate(rows: readonly Pick<PreviewRow, "status" | "line">[], allowed: ReadonlySet<number>): number {
  return rows.filter((r) => r.status === "new" || (r.status === "similar" && allowed.has(r.line))).length;
}
