import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Adds <link rel="preload"> for the main Arabic Tajawal weight so text does not
 * flash in a fallback face. The hashed file name is only known after bundling.
 */
function preloadBaseFont(): Plugin {
  return {
    name: "ht-preload-base-font",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const font = Object.keys(bundle).find((f) => /tajawal-arabic-400-normal.*\.woff2$/.test(f));
        if (!font) return html;
        const tag = `<link rel="preload" href="/v2/${font}" as="font" type="font/woff2" crossorigin>`;
        return html.replace("</head>", `  ${tag}\n</head>`);
      },
    },
  };
}

export default defineConfig(({ command }) => {
  // البناء لازم يكون production دايمًا. لو NODE_ENV جه من البيئة بقيمة تانية (Vercel مثلًا) Vite بيبني وضع التطوير:
  // JSX بيشيل اسم الملف والسطر لكل عنصر وبيتضاف preact/debug، فالحزمة بتبقى حوالي الضعف (120.0KB على Vercel مقابل 104.3KB).
  if (command === "build") process.env.NODE_ENV = "production";
  return {
  root: here,
  base: "/v2/",
  plugins: [preact(), preloadBaseFont()],
  resolve: { alias: { "@": path.join(here, "src") } },
  // احتياط: esbuild بيحوّل الحروف غير ASCII لـ \uXXXX لو charset مش محدد (والنصوص عندنا عربية). تحديده صراحةً بيثبّت الناتج.
  // (اتقاس على Vercel وطلع مش هو سبب تضخّم الحزمة: \uXXXX=25 بس؛ السبب كان وضع التطوير، شوف أول الدالة.)
  esbuild: { charset: "utf8" },
  publicDir: false,
  build: {
    outDir: path.resolve(here, "../public/v2"),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    target: "es2022",
    // التصغير صريح عشان حجم الحزمة ما يتغيّرش بين جهازك وVercel.
    minify: "esbuild",
    cssMinify: "esbuild",
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        app: path.join(here, "index.html"),
        gallery: path.join(here, "gallery.html"),
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: `http://localhost:${process.env.PORT ?? 3000}`, changeOrigin: true },
    },
  },
  define: { __DEV__: JSON.stringify(command === "serve") },
  };
});
