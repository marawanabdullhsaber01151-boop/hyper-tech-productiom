import { api } from "./api";
import { createStore, useStore } from "./lib/store";
import type { CartItem } from "./types";

interface CartState {
  items: CartItem[];
  loaded: boolean;
  busy: boolean;
}
export const cartStore = createStore<CartState>({ items: [], loaded: false, busy: false });
export const useCart = () => useStore(cartStore);

export const cartCount = (items: CartItem[]) => items.length;
export const cartPieces = (items: CartItem[]) => items.reduce((s, i) => s + Number(i.qty || 0), 0);

export async function loadCart(): Promise<void> {
  const items = await api.get<CartItem[]>("/portal/cart");
  cartStore.set({ items, loaded: true });
}

export function resetCart() {
  cartStore.set({ items: [], loaded: false, busy: false });
}

/** إضافة/ضبط كمية. السيرفر هو اللي بيتحقق من الحد الأدنى؛ لو رفض بنرجّع الحالة القديمة. */
export async function setCartQty(recipeId: number, qty: number, mode: "add" | "set" = "set"): Promise<void> {
  const prev = cartStore.get().items;
  if (mode === "set") {
    cartStore.set({ items: prev.map((i) => (i.recipeId === recipeId ? { ...i, qty: String(qty) } : i)) });
  }
  try {
    await api.post("/portal/cart", { bomRecipeId: recipeId, qty, mode });
    await loadCart();
  } catch (e) {
    cartStore.set({ items: prev });
    throw e;
  }
}

export async function removeFromCart(recipeId: number): Promise<void> {
  const prev = cartStore.get().items;
  cartStore.set({ items: prev.filter((i) => i.recipeId !== recipeId) });
  try {
    await api.delete(`/portal/cart/${recipeId}`);
  } catch (e) {
    cartStore.set({ items: prev });
    throw e;
  }
}

export async function clearCartLocal() {
  await Promise.all(cartStore.get().items.map((i) => api.delete(`/portal/cart/${i.recipeId}`).catch(() => undefined)));
  cartStore.set({ items: [] });
}
