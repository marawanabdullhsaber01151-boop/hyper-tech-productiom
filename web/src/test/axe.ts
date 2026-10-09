import axeCore from "axe-core";

/** axe في jsdom: قواعد الألوان والـ layout مش بتشتغل هنا (بتتفحص في Chromium الحقيقي من gallery). */
export async function axe(node: Element) {
  return axeCore.run(node, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
}
