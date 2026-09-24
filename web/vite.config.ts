import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocusMode } from "./src/network/mode.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, "");
  const locusMode = buildLocusMode(env.VITE_LOCUS_MODE, command);

  return {
    define: { __LOCUS_MODE__: JSON.stringify(locusMode) },
    plugins: [
      react(),
      {
        name: "locus-mode-meta",
        transformIndexHtml(html) {
          return html.replace("</head>", `  <meta name="locus-mode" content="${locusMode}" />\n  </head>`);
        },
      },
    ],
    optimizeDeps: {
      exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
    },
    resolve: {
      alias: {
        "@archelabs/locus": path.resolve(root, "../sdk/src/index.ts"),
      },
    },
    server: {
      port: 5173,
    },
  };
});
