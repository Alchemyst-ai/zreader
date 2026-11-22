import * as acorn from "acorn";
import { describe, expect, it } from "vitest";
import { rewriteJavaScript } from "../src/sandbox/browser/rewrite";

/** Runs rewritten cells one after another in one shared global scope, like a Kernel. */
async function kernel() {
  // A `with` scope stands in for the worker's global object: the rewrite assigns undeclared globals.
  const globals: Record<string, unknown> = {};
  const scope = new Proxy(globals, { has: (_t, k) => typeof k === "string" && !(k in globalThis) });
  return (code: string) => {
    const body = rewriteJavaScript(code, acorn);
    return new Function("scope", `with (scope) { return (async () => { ${body}\n })(); }`)(scope) as Promise<unknown>;
  };
}

describe("rewriting JavaScript for a Kernel", () => {
  it("keeps top-level declarations for later runs", async () => {
    const run = await kernel();
    await run("const n = 20\nlet { a, b: [c] } = { a: 1, b: [2] }\nvar u");
    expect(await run("n * 2 + a + c")).toBe(43);
    expect(await run("u")).toBeUndefined();
  });

  it("lets a const be declared again in a later run", async () => {
    const run = await kernel();
    await run("const n = 1");
    expect(await run("const n = 2\nn")).toBe(2);
  });

  it("returns the value of the last expression, but not of a declaration", async () => {
    const run = await kernel();
    expect(await run("1 + 1")).toBe(2);
    expect(await run("const x = 5")).toBeUndefined();
    expect(await run("x; // trailing comment")).toBe(5);
    expect(await run("({ a: 1 })")).toEqual({ a: 1 });
  });

  it("supports top-level await", async () => {
    const run = await kernel();
    expect(await run("const v = await Promise.resolve(7)\nv * 6")).toBe(42);
  });

  it("keeps functions hoisted and classes defined", async () => {
    const run = await kernel();
    await run("double(1)\nfunction double(x) { return x * 2 }\nclass Point { constructor(x) { this.x = x } }");
    expect(await run("double(new Point(4).x)")).toBe(8);
  });

  it("rewrites imports to dynamic imports", () => {
    const out = rewriteJavaScript('import d, { a as b, c } from "https://esm.sh/x"\nimport * as ns from "y"\nimport "z"', acorn);
    expect(out).toContain(';({ default: d, a: b, c } = await import("https://esm.sh/x"));');
    expect(out).toContain('ns = await import("y");');
    expect(out).toContain('await import("z");');
  });

  it("reports syntax errors with their position", () => {
    expect(() => rewriteJavaScript("let = ;", acorn)).toThrow(SyntaxError);
  });
});
