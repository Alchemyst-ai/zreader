import { defineConfig, type Options } from "tsup";

/**
 * Self-references (`zreader/*`) are kept external on purpose:
 * - client entries ("use client") must not inline server code and vice versa;
 * - `virtual-config` / `user-config` must be resolved by the *app's* bundler so
 *   that `withReader()` aliases can point them at the project's reader.config.ts.
 */
const external = [
  /^zreader(\/.*)?$/,
  /^@tiptap\//,
  "react",
  "react-dom",
  "react/jsx-runtime",
  "next",
  /^next\//,
];

const shared: Options = {
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  external,
  outDir: "dist",
};

export default defineConfig([
  {
    ...shared,
    entry: {
      "core/index": "src/core/index.ts",
      "content/index": "src/content/index.ts",
      "next/server/index": "src/next/server/index.tsx",
      "rehype/index": "src/rehype/index.ts",
      "virtual-config/index": "src/virtual-config/index.ts",
      "user-config/index": "src/user-config/index.ts",
      "stubs/server-only": "src/stubs/server-only.ts",
      "stubs/empty-config": "src/stubs/empty-config.ts",
    },
    platform: "node",
  },
  {
    // Loaded from next.config.* — ship CJS as well as ESM.
    ...shared,
    splitting: false,
    format: ["esm", "cjs"],
    entry: {
      "config/index": "src/config/index.ts",
      "next/index": "src/next/index.ts",
    },
    platform: "node",
  },
  {
    ...shared,
    entry: {
      "react/index": "src/react/index.ts",
      "editor/index": "src/editor/index.tsx",
      "next/client/index": "src/next/client/index.tsx",
    },
    // Unsplit so every client entry file can carry the directive (see scripts/use-client.mjs).
    splitting: false,
    platform: "browser",
  },
]);
