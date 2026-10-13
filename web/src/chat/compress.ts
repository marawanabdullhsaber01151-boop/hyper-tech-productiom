const MAX_BYTES = 600 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad"));
    };
    img.src = url;
  });
}

export const ALLOWED_IMAGE = /^image\/(png|jpe?g|webp)$/;

/** بيصغّر الصورة لـ JPEG أقل من 600KB ويرجّع data URL (نفس الطريقة القديمة). */
export async function compressImage(file: File): Promise<string> {
  const img = await loadImage(file);
  let maxSide = 1280;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.55, 0.42]) {
      const dataUrl = canvas.toDataURL("image/jpeg", q);
      const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
      if (bytes <= MAX_BYTES) return dataUrl;
    }
    maxSide = Math.round(maxSide * 0.75);
  }
  throw new Error("too-big");
}
