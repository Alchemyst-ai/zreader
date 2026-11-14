import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^zreader\/config$/, replacement: r("./src/config/index.ts") },
      { find: /^zreader\/plugins\/agent$/, replacement: r("./src/plugins/agent/index.ts") },
      { find: /^zreader\/react$/, replacement: r("./src/react/index.ts") },
      { find: /^zreader\/editor$/, replacement: r("./src/editor/index.tsx") },
      { find: /^zreader\/next\/client$/, replacement: r("./src/next/client/index.tsx") },
      { find: /^zreader\/next\/server$/, replacement: r("./src/next/server/index.tsx") },
      { find: /^zreader\/rehype$/, replacement: r("./src/rehype/index.ts") },
      { find: /^zreader\/agent\/react$/, replacement: r("./src/agent/react/index.ts") },
      { find: /^zreader\/agent$/, replacement: r("./src/agent/index.ts") },
      { find: /^zreader\/content$/, replacement: r("./src/content/index.ts") },
      { find: /^zreader\/virtual-config$/, replacement: r("./src/virtual-config/index.ts") },
      { find: /^zreader\/user-config$/, replacement: r("./src/stubs/empty-config.ts") },
      { find: /^zreader$/, replacement: r("./src/core/index.ts") },
      { find: /^@\//, replacement: r("./src/react/") + "/" },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
