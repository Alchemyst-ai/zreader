/** Node-only helpers for locating and loading reader.config.* (via jiti). */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE_NAMES, type ReaderUserConfig } from "./index";

/** Search `from` and its parents (up to the filesystem root or a `.git` dir) for reader.config.*. */
export function findConfigFile(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    if (existsSync(join(dir, "package.json")) || existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadConfigFile(file: string): Promise<ReaderUserConfig> {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(file, { interopDefault: true, moduleCache: false });
  const mod = (await jiti.import(file)) as { default?: ReaderUserConfig } | ReaderUserConfig;
  const cfg = (mod && typeof mod === "object" && "default" in mod ? mod.default : mod) as ReaderUserConfig | undefined;
  return cfg ?? {};
}
