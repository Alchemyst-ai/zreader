// Rollup drops module-level directives; re-add "use client" to client entries.
import { readFileSync, writeFileSync } from "node:fs";
for (const f of ["react/index.js", "editor/index.js", "next/client/index.js"]) {
  const url = new URL(`../dist/${f}`, import.meta.url);
  const src = readFileSync(url, "utf8");
  if (!src.startsWith('"use client"')) writeFileSync(url, `"use client";\n${src}`);
}
