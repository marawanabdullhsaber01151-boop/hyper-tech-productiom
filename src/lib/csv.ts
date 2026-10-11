/** @format */
/**
 * CSV cell escaping that is safe against spreadsheet formula injection:
 * a value starting with = + - @ (or tab / CR) gets a leading apostrophe.
 * Numbers produced by code (not user text) can bypass via `csvNumber`.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\n")}`;
}
