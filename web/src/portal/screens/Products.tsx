import { useEffect, useMemo, useState } from "preact/hooks";
import { t } from "../../copy";
import { Button, Dialog, Drawer, EmptyState, FilterBar, Icon, IconButton, Input, Field, InlineAlert, useToast } from "../../design/components";
import { ChevronLeft, ChevronRight, Heart, ImageOff, Plus } from "../../design/icons";
import { useMutation, useQuery } from "../../api/hooks";
import { formatNumber } from "../../lib/format";
import { api } from "../api";
import { can } from "../session";
import { setCartQty, useCart } from "../cart";
import type { Product, ProductDetail } from "../types";
import { ListSkeleton, LoadError } from "./shared";

function useConfig() {
  return useQuery(() => api.get<{ minimumOrderQuantity: number }>("/portal/config", { anonymous: true }), []);
}

function useWishlist() {
  const [ids, setIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!can("cart.use")) return;
    api
      .get<Array<{ recipeId: number }>>("/portal/wishlist")
      .then((r) => setIds(new Set(r.map((x) => x.recipeId))))
      .catch(() => undefined);
  }, []);
  const toggle = async (id: number) => {
    const has = ids.has(id);
    setIds((s) => {
      const n = new Set(s);
      if (has) n.delete(id);
      else n.add(id);
      return n;
    });
    try {
      if (has) await api.delete(`/portal/wishlist/${id}`);
      else await api.post("/portal/wishlist", { bomRecipeId: id });
    } catch {
      setIds((s) => {
        const n = new Set(s);
        if (has) n.add(id);
        else n.delete(id);
        return n;
      });
    }
  };
  return { ids, toggle };
}

export function ProductImage({ src, name }: { src: string | null | undefined; name: string }) {
  return src ? <img src={src} alt={t("p.products.image", { name })} loading="lazy" decoding="async" /> : <Icon icon={ImageOff} size={32} label={t("p.products.noImage")} />;
}

export function Products() {
  const list = useQuery((signal) => api.get<Product[]>("/portal/products", { signal }), []);
  const [q, setQ] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  // ?open=<id> بيفتح المنتج مباشرة (من «طلبات الأسعار»)
  const [openId, setOpenId] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(location.search).get("open"));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const wish = useWishlist();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? []).filter((p) => (!s || p.productName.toLowerCase().includes(s) || p.productCode.toLowerCase().includes(s)) && (!onlyFav || wish.ids.has(p.id)));
  }, [list.data, q, onlyFav, wish.ids]);

  return (
    <>
      <div class="pt-page-head">
        <h1 class="pt-page-title">{t("p.products.title")}</h1>
        <Button variant={onlyFav ? "primary" : "secondary"} size="sm" icon={Heart} aria-pressed={onlyFav} onClick={() => setOnlyFav((v) => !v)}>
          {t("p.products.onlyFav")}
        </Button>
      </div>
      <FilterBar search={q} onSearch={setQ} searchLabel={t("p.products.search")} />
      {list.error ? <LoadError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.loading && !list.data ? <ListSkeleton rows={4} /> : null}
      {list.data && rows.length === 0 ? <EmptyState title={q || onlyFav ? t("p.products.noResults") : t("p.products.empty")} description={q ? t("empty.searchHint") : undefined} /> : null}
      <div class="pt-grid">
        {rows.map((p) => (
          <button key={p.id} type="button" class="pt-product" onClick={() => setOpenId(p.id)}>
            <span class="pt-product__img">
              <ProductImage src={p.primaryImage} name={p.productName} />
            </span>
            <span class="pt-product__info">
              <span class="pt-product__name">{p.productName}</span>
              <span class="pt-product__code">{p.productCode}</span>
            </span>
          </button>
        ))}
      </div>
      <ProductDrawer id={openId} onClose={() => setOpenId(null)} fav={openId !== null && wish.ids.has(openId)} onFav={() => openId !== null && void wish.toggle(openId)} />
    </>
  );
}

/** عرض مكبّر لصور المنتج: تنقّل بالأسهم (RTL)، وضغطة على الصورة بتكبّرها. */
export function Lightbox({ images, index, name, onIndex, onClose }: { images: string[]; index: number | null; name: string; onIndex: (i: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const open = index !== null;
  const n = images.length;
  const go = (d: number) => {
    if (index === null || n < 2) return;
    setZoom(false);
    onIndex((index + d + n) % n);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      // الواجهة RTL: السهم الشمال = الصورة اللي بعدها
      if (e.key === "ArrowLeft") go(1);
      else if (e.key === "ArrowRight") go(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, index, n]);
  useEffect(() => setZoom(false), [open]);
  const src = index === null ? undefined : images[index];
  return (
    <Dialog open={open} onClose={onClose} title={t("p.lb.title")} description={index === null ? undefined : t("p.lb.of", { i: index + 1, n })} size="lg">
      {src ? (
        <div class="pt-lb">
          <button type="button" class={`pt-lb__stage${zoom ? " pt-lb__stage--zoom" : ""}`} aria-label={zoom ? t("p.lb.fit") : t("p.lb.zoom")} onClick={() => setZoom((z) => !z)}>
            <img src={src} alt={t("p.products.image", { name })} />
          </button>
          {n > 1 ? (
            <div class="pt-row pt-row--between">
              <IconButton icon={ChevronRight} label={t("p.lb.prev")} variant="secondary" onClick={() => go(-1)} />
              <IconButton icon={ChevronLeft} label={t("p.lb.next")} variant="secondary" onClick={() => go(1)} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function ProductDrawer({ id, onClose, fav, onFav }: { id: number | null; onClose: () => void; fav: boolean; onFav: () => void }) {
  const detail = useQuery((signal) => (id === null ? Promise.resolve(null) : api.get<ProductDetail>(`/portal/products/${id}`, { signal })), [id]);
  const cfg = useConfig();
  const cart = useCart();
  const toast = useToast();
  const [unit, setUnit] = useState<"piece" | "carton">("piece");
  const [qty, setQty] = useState("");
  const [lb, setLb] = useState<number | null>(null);
  const d = detail.data;
  const min = cfg.data?.minimumOrderQuantity ?? 1;
  const per = d?.cartonConversion?.piecesPerCarton ?? 0;
  const pieces = (unit === "carton" ? Number(qty) * per : Number(qty)) || 0;
  const inCart = d ? cart.items.find((i) => i.recipeId === d.id) : undefined;

  useEffect(() => {
    setQty("");
    setUnit("piece");
    setLb(null);
  }, [id]);

  const add = useMutation(async () => {
    if (!d) return;
    await setCartQty(d.id, Math.round(pieces), "add");
    toast({ tone: "success", message: t("p.products.added") });
    setQty("");
  });
  const ask = useMutation(async () => {
    if (!d) return;
    await api.post("/portal/price-inquiries", { bomRecipeId: d.id, qty: String(Math.round(pieces) || min), orderUnit: "piece" });
    toast({ tone: "success", message: t("p.products.priceSent") });
  });

  const imgs = d ? [d.primaryImage, ...(d.secondaryImages ?? [])].filter((x): x is string => !!x) : [];
  return (
    <Drawer open={id !== null} onClose={onClose} title={d?.productName ?? t("p.loading")} description={d ? t("p.products.code", { code: d.productCode }) : undefined}>
      {detail.error ? <LoadError error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {d ? (
        <div class="pt-stack">
          {imgs.length ? (
            <div class={`pt-gallery${imgs.length === 1 ? " pt-gallery--single" : ""}`} role="group" aria-label={t("p.products.gallery")}>
              {imgs.map((src, i) => (
                <button key={i} type="button" class="pt-gallery__btn" aria-label={t("p.lb.open")} onClick={() => setLb(i)}>
                  <img src={src} alt={t("p.products.image", { name: d.productName })} loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
          <div class="pt-row pt-row--between">
            <span class="pt-muted">{t("p.products.components", { n: formatNumber(d.componentsCount) })}</span>
            <IconButton icon={Heart} label={fav ? t("p.products.unfavorite") : t("p.products.favorite")} variant={fav ? "secondary" : "ghost"} onClick={onFav} aria-pressed={fav} />
          </div>
          {d.description ? <p>{d.description}</p> : null}
          {d.featuredIngredients?.length ? (
            <div class="pt-stack">
              <strong>{t("p.products.featured")}</strong>
              <div class="pt-chips">
                {d.featuredIngredients.map((f, i) => {
                  const pic = f.imageData ?? f.image;
                  return (
                    <span key={i} class="ht-pill pt-feat">
                      {pic ? <img class="pt-feat__img" src={pic} alt="" loading="lazy" /> : null}
                      {f.name ?? f.materialName}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
          {can("cart.use") ? (
            <div class="pt-stack">
              <p class="pt-muted">{t("p.products.min", { n: formatNumber(min) })}</p>
              {inCart ? <p class="pt-muted">{t("p.products.inCart", { n: formatNumber(Number(inCart.qty)) })}</p> : null}
              {per > 1 ? (
                <>
                  <p class="pt-muted">{t("p.products.carton", { n: formatNumber(per), unit: d.baseUnit ?? "" })}</p>
                  <div class="pt-seg" role="group" aria-label={t("p.products.unit")}>
                    <button type="button" aria-pressed={unit === "piece"} onClick={() => setUnit("piece")}>
                      {t("p.products.byPiece")}
                    </button>
                    <button type="button" aria-pressed={unit === "carton"} onClick={() => setUnit("carton")}>
                      {t("p.products.byCarton")}
                    </button>
                  </div>
                </>
              ) : null}
              <Field label={unit === "carton" ? t("p.products.cartons") : t("p.products.qty")} hint={unit === "carton" && pieces ? t("p.products.cartonsHint", { n: formatNumber(pieces) }) : undefined}>
                <Input type="number" inputMode="numeric" min={1} dir="ltr" value={qty} onInput={(e) => setQty((e.currentTarget as HTMLInputElement).value)} />
              </Field>
              {add.error ? <InlineAlert tone="danger">{add.error.message}</InlineAlert> : null}
              {ask.error ? <InlineAlert tone="danger">{ask.error.message}</InlineAlert> : null}
              <div class="pt-row">
                <Button icon={Plus} loading={add.loading} disabled={pieces < 1} onClick={() => void add.mutate(undefined)}>
                  {t("p.products.add")}
                </Button>
                <Button variant="secondary" loading={ask.loading} disabled={pieces < 1} onClick={() => void ask.mutate(undefined)}>
                  {t("p.products.priceAsk")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <Lightbox images={imgs} index={lb} name={d?.productName ?? ""} onIndex={setLb} onClose={() => setLb(null)} />
    </Drawer>
  );
}
