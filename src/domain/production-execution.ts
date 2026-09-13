/** @format */

export function validateBatchQuantities(input: {
  producedQty: number;
  acceptedQty: number;
  reworkQty: number;
  scrapQty: number;
  plannedQty: number;
  closing?: boolean;
}): void {
  const quantities = [
    input.producedQty,
    input.acceptedQty,
    input.reworkQty,
    input.scrapQty,
    input.plannedQty,
  ];
  if (quantities.some((value) => !Number.isFinite(value) || value < 0)) {
    throw Object.assign(new Error("كميات الدفعة يجب أن تكون أرقامًا موجبة أو صفرًا"), {
      status: 400,
    });
  }
  const accountedFor = input.acceptedQty + input.reworkQty + input.scrapQty;
  if (input.producedQty + 0.0005 < accountedFor) {
    throw Object.assign(new Error("الكميات المقبولة وإعادة التشغيل والهالك تتجاوز المنتج"), {
      status: 400,
    });
  }
  if (input.closing && Math.abs(input.producedQty - accountedFor) > 0.0005) {
    throw Object.assign(new Error("لا يمكن إغلاق الدفعة قبل موازنة الكميات"), {
      status: 400,
    });
  }
  if (input.closing && input.producedQty > input.plannedQty + 0.0005) {
    throw Object.assign(new Error("الكمية المنتجة تتجاوز الكمية المخططة"), {
      status: 400,
    });
  }
}
