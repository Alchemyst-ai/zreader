// Guard: the React core must stay framework-free. Fails the build if the client
// bundles (or the chunks they import) reference Next.js or Node built-ins.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const entries = ["react/index.js", "editor/index.js", "agent/react/index.js", "rehype/index.js", "core/index.js"];
const FORBIDDEN = /from\s*['"](next(?:\/[^'"]*)?|node:[^'"]+|fs|fs\/promises|path|crypto|os|url)['"]/g;
const seen = new Set();
const problems = [];

function check(file) {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(FORBIDDEN)) problems.push(`${file.slice(dist.length + 1)} imports "${m[1]}"`);
  for (const m of src.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) check(join(dirname(file), m[1]));
}

for (const e of entries) check(join(dist, e));
if (problems.length) {
  console.error("Framework-free bundles must not import Next.js or Node built-ins:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`check-bundles: ${seen.size} files clean (no next/* or Node built-ins)`);

// The plugin factories are read by next.config, so their entry chunk must stay
// light: no unified, no content layer, no virtual config (§4.3).
const HEAVY = /from\s*['"](unified|zreader\/content|zreader\/virtual-config)['"]/g;
const pluginEntry = join(dist, "plugins/agent/index.js");
if (!existsSync(pluginEntry)) {
  console.error("check-bundles: dist/plugins/agent/index.js is missing");
  process.exit(1);
}
const heavy = [...readFileSync(pluginEntry, "utf8").matchAll(HEAVY)].map((m) => m[1]);
if (heavy.length) {
  console.error(
    "zreader/plugins/agent must not pull heavy dependencies into its entry chunk:\n  " +
      [...new Set(heavy)].join("\n  "),
  );
  process.exit(1);
}
console.log("check-bundles: zreader/plugins/agent entry chunk is light");
