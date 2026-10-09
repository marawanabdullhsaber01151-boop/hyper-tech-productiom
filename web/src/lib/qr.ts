/** QR كـ SVG string. المكتبة بتتحمّل وقت الطلب بس (مش في الباندل الأساسي). */
export async function qrSvg(text: string, opts: { size?: number } = {}): Promise<string> {
  const mod = await import("qrcode-generator");
  const qrcode = (mod as unknown as { default: typeof import("qrcode-generator") }).default ?? (mod as never);
  const qr = (qrcode as unknown as (type: number, level: string) => any)(0, "M");
  qr.addData(text);
  qr.make();
  const n: number = qr.getModuleCount();
  const quiet = 2;
  const total = n + quiet * 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const s = opts.size ?? 200;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${s}" height="${s}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
