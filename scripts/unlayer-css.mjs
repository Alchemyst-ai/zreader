/**
 * The standalone stylesheet ships *unlayered*.
 *
 * Unlayered host CSS (e.g. a site's global `footer {}` or `h1 {}`) beats every
 * rule inside `@layer`, whatever its specificity. Unwrapping the layers — in
 * cascade order properties → theme → base → components → utilities → rest —
 * lets the reader's class utilities win on specificity instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const file = new URL("../dist/styles.css", import.meta.url);
const root = postcss.parse(readFileSync(file, "utf8"));
const order = ["properties", "theme", "base", "components", "utilities"];
const buckets = new Map(order.map((n) => [n, []]));
const rest = [];

for (const node of [...root.nodes]) {
  if (node.type === "atrule" && node.name === "layer") {
    if (!node.nodes) continue; // `@layer a, b;` order statements
    const name = node.params.trim();
    (buckets.get(name) ?? rest).push(...node.nodes.map((n) => n.clone()));
  } else {
    rest.push(node.clone());
  }
}

const out = postcss.root();
for (const name of order) out.append(...buckets.get(name));
out.append(...rest);
writeFileSync(file, out.toString());
