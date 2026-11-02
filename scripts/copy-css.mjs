// Ship the Tailwind-host stylesheet and shared reader rules as source CSS.
import { copyFileSync, mkdirSync } from "node:fs";
const dist = new URL("../dist/", import.meta.url);
mkdirSync(dist, { recursive: true });
for (const f of ["tailwind.css", "reader.css"]) copyFileSync(new URL(`../src/${f}`, import.meta.url), new URL(f, dist));
