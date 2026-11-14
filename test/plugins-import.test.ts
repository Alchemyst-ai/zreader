import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `reader.config.ts` is loaded by jiti inside `next.config`, so the plugin
 * factories must stay light: `unified`, the content layer and the virtual config
 * may only appear inside a hook, as a dynamic `import()` (§4.3).
 */
const ENTRY = resolve(import.meta.dirname, "../src/plugins/agent/index.ts");
const FORBIDDEN = ["unified", "zreader/content", "zreader/virtual-config", "zreader/user-config"];

/** Static `import`/`export … from` specifiers, skipping type-only statements. */
function staticSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /(?:^|\n)[ \t]*(?:import|export)[ \t]+([^\n]*?)from[ \t]*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    if (/^type\b/.test(m[1]!)) continue;
    out.push(m[2]!);
  }
  return out;
}

function resolveFile(from: string, spec: string): string | null {
  for (const candidate of [resolve(dirname(from), spec), resolve(dirname(from), `${spec}.ts`), resolve(dirname(from), `${spec}.tsx`)]) {
    try {
      if (readFileSync(candidate)) return candidate;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

describe("zreader/plugins/agent", () => {
  it("never statically imports unified, the content layer or the virtual config", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const stack = [ENTRY];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of staticSpecifiers(file)) {
        if (FORBIDDEN.includes(spec)) offenders.push(`${file.slice(file.indexOf("/src/"))} → ${spec}`);
        if (!spec.startsWith(".")) continue;
        const next = resolveFile(file, spec);
        if (next && /\.(ts|tsx)$/.test(extname(next))) stack.push(next);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("builds every plugin descriptor without touching the filesystem", async () => {
    const { cors, disable, frontmatter, llmsTxt, mcp, notFound } = await import("../src/plugins/agent/index");
    const plugins = [cors(), disable("notFound"), frontmatter(), llmsTxt({ full: true, root: true }), mcp(), notFound()];
    expect(plugins.map((p) => p.name)).toEqual([
      "cors",
      "disable(notFound)",
      "frontmatter",
      "llmsTxt",
      "mcp",
      "notFound",
    ]);
    expect(llmsTxt({ full: true }).routes!.map((r) => r.path)).toEqual(["/llms.txt", "/llms-full.txt"]);
    expect(llmsTxt().rootRoutes).toBeUndefined();
    expect(llmsTxt({ root: true }).rootRoutes!.map((r) => r.path)).toEqual(["/llms.txt"]);
    expect(mcp().routes![0]!.methods).toEqual(["POST"]);
    expect(cors().routes![0]!.methods).toEqual(["OPTIONS"]);
  });
});
