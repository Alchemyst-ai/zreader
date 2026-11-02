// Runs arethetypeswrong against the packed tarball.
// `npm publish --dry-run` sets npm_config_dry_run=true for lifecycle scripts, which makes the
// `npm pack` that attw runs internally skip writing the tarball. Clear it for this step only.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toLowerCase() === "npm_config_dry_run") delete env[key];

const args = [
  "attw",
  "--pack",
  ".",
  "--profile",
  "esm-only",
  "--ignore-rules",
  "cjs-resolves-to-esm",
  // CSS exports have no type declarations by design.
  "--exclude-entrypoints",
  "styles.css",
  "tailwind.css",
  "reader.css",
];

const result = spawnSync("npx", ["--no-install", ...args], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(result.status ?? 1);
