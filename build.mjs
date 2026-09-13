import { build } from "esbuild";

build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
