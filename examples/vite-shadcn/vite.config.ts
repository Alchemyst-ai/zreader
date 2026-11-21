import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { defineConfig } from "vite";
// The content layer's plugins run at build time, in Node: the same image and
// math handling the Next.js adapter uses, applied to MDX compiled by Vite.
import { rehypeImages, rehypeMath } from "zreader/content";
import { rehypeBlocks } from "zreader/rehype";

const publicDir = fileURLToPath(new URL("./public", import.meta.url));

export default defineConfig({
  plugins: [
    {
      enforce: "pre",
      ...mdx({
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [
          [rehypeMath, { math: { engine: "katex" } }],
          [rehypeImages, { publicDir }],
          rehypeBlocks,
        ],
      }),
    },
    react({ include: /\.(mdx|tsx?)$/ }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
