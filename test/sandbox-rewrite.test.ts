import * as acorn from "acorn";
import { describe, expect, it } from "vitest";
import * as sucrase from "sucrase";
import { browserSandbox, stripTypes } from "../src/sandbox/browser/index";
import { rewriteJavaScript } from "../src/sandbox/browser/rewrite";

/** Runs rewritten code one run after another in one shared global scope, like a Kernel. */
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

  it("drops `export` but keeps what it declares", async () => {
    const run = await kernel();
    await run("export const a = 1\nexport function f() { return 2 }\nexport { a as b }\nexport default 40");
    expect(await run("a + f()")).toBe(3);
    expect(() => rewriteJavaScript("export default function () {}\nexport default class {}", acorn)).toThrow(); // two defaults
    expect(() => new Function(rewriteJavaScript("export default function () { return 1 }", acorn))).not.toThrow();
  });

  it("reports syntax errors with their position", () => {
    expect(() => rewriteJavaScript("let = ;", acorn)).toThrow(SyntaxError);
  });
});

describe("TypeScript", () => {
  async function tsKernel() {
    const globals: Record<string, unknown> = {};
    const scope = new Proxy(globals, { has: (_t, k) => typeof k === "string" && !(k in globalThis) });
    return (code: string) => new Function("scope", `with (scope) { return (async () => { ${rewriteJavaScript(stripTypes(code, sucrase), acorn)}\n })(); }`)(scope) as Promise<unknown>;
  }

  it("runs typed code and keeps its variables", async () => {
    const run = await tsKernel();
    await run("interface P { x: number }\nconst p: P = { x: 40 } as P\nfunction add<T extends number>(a: T, b: T): number { return a + b }");
    expect(await run("add(p.x, 2 as number)")).toBe(42);
    expect(await run("enum Color { Red, Green }\nColor.Green")).toBe(1);
  });

  it("reports a TypeScript syntax error as a SyntaxError", () => {
    expect(() => stripTypes("let x: = 1", sucrase)).toThrow(SyntaxError);
  });

  it("is offered only when the site passes sucrase", () => {
    expect(browserSandbox().languages).not.toContain("typescript");
    expect(browserSandbox({ typescript: async () => sucrase }).languages).toContain("typescript");
  });
});
