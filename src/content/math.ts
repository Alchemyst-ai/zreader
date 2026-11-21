/**
 * TeX math for compiled chapters. Opt-in (`content.math`), with three engines
 * that all render **MathML**, so no engine CSS or fonts are required and the
 * sanitizer never has to allow inline styles:
 *
 *   "katex"   → `katex` (output: "mathml")
 *   "temml"   → `temml`
 *   "mathjax" → `@mathjax/src` (TeX → MathML)
 *
 * The engine is an optional dependency, loaded only when selected.
 *
 * Math is found by `remark-math` (`$…$`, `$$…$$`, fenced ```math) in `.md`/`.mdx`,
 * and by `rehypeMathDelimiters` (`\(…\)`, `\[…\]`, `$$…$$`) in `.html` chapters.
 * Both produce `<code class="language-math math-inline|math-display">`, which
 * `rehypeMath` replaces with `<math>` *after* sanitizing.
 */
import type { Element, ElementContent, Parents, Root, Text } from "hast";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import { visitParents } from "unist-util-visit-parents";
import type { MathConfig, MathEngine, MathOption } from "../config/index";

export const MATH_PACKAGES: Record<MathEngine, string> = {
  katex: "katex",
  temml: "temml",
  mathjax: "@mathjax/src",
};

/** `content.math` → a config object, or `null` when math is off. */
export function resolveMath(option: MathOption | undefined | null): MathConfig | null {
  if (!option) return null;
  return typeof option === "string" ? { engine: option } : option;
}

/** TeX → a MathML string. */
export type MathRenderer = (tex: string, display: boolean) => string;

export class MathEngineMissingError extends Error {
  constructor(public readonly engine: MathEngine) {
    super(`content.math = "${engine}" needs the ${MATH_PACKAGES[engine]} package: npm i ${MATH_PACKAGES[engine]}`);
    this.name = "MathEngineMissingError";
  }
}

function isMissing(e: unknown, pkg: string): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err?.code === "ERR_MODULE_NOT_FOUND" ||
    err?.code === "MODULE_NOT_FOUND" ||
    (typeof err?.message === "string" && err.message.includes(pkg) && /cannot find|not found|resolve/i.test(err.message))
  );
}

// Engine imports carry bundler-ignore comments: the engines are optional, so a
// bundler must not try to resolve the ones the app didn't install. They run in Node.
async function load<T>(engine: MathEngine, importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (e) {
    if (isMissing(e, MATH_PACKAGES[engine])) throw new MathEngineMissingError(engine);
    throw e;
  }
}

function unwrapDefault<T>(m: T | { default: T }): T {
  return (m as { default?: T }).default ?? (m as T);
}

const MATHJAX_PACKAGES = ["base", "ams", "newcommand", "configmacros", "noundefined", "boldsymbol", "braket", "cancel", "cases", "color", "mathtools"];

async function createRenderer(config: MathConfig): Promise<MathRenderer> {
  const options = config.options ?? {};
  const macros = config.macros ?? {};
  switch (config.engine) {
    case "katex": {
      const katex = unwrapDefault(await load("katex", () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "katex")));
      return (tex, display) =>
        katex.renderToString(tex, { throwOnError: false, strict: "ignore", ...options, macros: { ...macros }, displayMode: display, output: "mathml" });
    }
    case "temml": {
      const temml = unwrapDefault(await load("temml", () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "temml"))) as {
        renderToString(tex: string, opts?: Record<string, unknown>): string;
      };
      return (tex, display) => temml.renderToString(tex, { throwOnError: false, ...options, macros: { ...macros }, annotate: true, displayMode: display });
    }
    case "mathjax": {
      const [{ TeX }, { HTMLDocument }, { liteAdaptor }, { STATE }, { SerializedMmlVisitor }] = await load("mathjax", () =>
        Promise.all([
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/handlers/html/HTMLDocument.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/adaptors/liteAdaptor.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/core/MathItem.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/braket/BraketConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/cases/CasesConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/color/ColorConfiguration.js"),
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js"),
        ] as const),
      );
      // MathJax names macros without the backslash: { RR: "\\mathbb{R}" }.
      const mjMacros = Object.fromEntries(Object.entries(macros).map(([k, v]) => [k.replace(/^\\/, ""), v]));
      const tex = new TeX({ packages: MATHJAX_PACKAGES, ...options, macros: mjMacros } as never);
      const doc = new HTMLDocument("", liteAdaptor(), { InputJax: tex } as never);
      const visitor = new SerializedMmlVisitor();
      return (src, display) => visitor.visitTree(doc.convert(src, { display, end: STATE.CONVERT } as never) as never) as string;
    }
  }
}

const renderers = new Map<string, Promise<MathRenderer>>();

/** A cached renderer for one math config. Throws `MathEngineMissingError` when the engine isn't installed. */
export function getMathRenderer(config: MathConfig): Promise<MathRenderer> {
  const key = JSON.stringify(config);
  let p = renderers.get(key);
  if (!p) {
    p = createRenderer(config);
    renderers.set(key, p);
    p.catch(() => renderers.delete(key));
  }
  return p;
}

// ------------------------------------------------------------- hast helpers

const parser = unified().use(rehypeParse, { fragment: true });

function classes(el: Element): string[] {
  const c = el.properties?.className as unknown;
  return Array.isArray(c) ? c.map(String) : typeof c === "string" ? c.split(/\s+/) : [];
}

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

const ENGINE_ATTR = /^(data[A-Z]|data-)/;

/** Engine output → one `<math>` element with a TeX annotation, engine extras removed. */
export function toMathElement(markup: string, tex: string, display: boolean): Element | null {
  const tree = parser.parse(markup);
  let math: Element | null = null;
  visitParents(tree, "element", (el: Element) => {
    if (el.tagName === "math") {
      math = el;
      return false;
    }
    return undefined;
  });
  if (!math) return null;
  const m = math as Element;
  // Engine attributes (MathJax's data-latex, Temml's class/style) are not needed.
  visitParents(m, "element", (el: Element) => {
    for (const k of Object.keys(el.properties ?? {})) {
      if (k === "style" || k === "className" || ENGINE_ATTR.test(k)) delete el.properties[k];
    }
  });
  const props = m.properties;
  delete props.xmlns;
  if (display) props.display = "block";
  else delete props.display;
  const hasAnnotation = (function find(n: Element): boolean {
    return n.children.some((c) => c.type === "element" && (c.tagName === "annotation" || find(c)));
  })(m);
  if (!hasAnnotation) {
    const body: ElementContent[] = m.children.filter((c) => !(c.type === "text" && !c.value.trim()));
    const row: Element = body.length === 1 && body[0]!.type === "element" ? (body[0] as Element) : { type: "element", tagName: "mrow", properties: {}, children: body };
    m.children = [
      {
        type: "element",
        tagName: "semantics",
        properties: {},
        children: [row, { type: "element", tagName: "annotation", properties: { encoding: "application/x-tex" }, children: [{ type: "text", value: tex }] }],
      },
    ];
  }
  // The TeX source is for copy and agents; keep it out of highlight text.
  visitParents(m, "element", (el: Element) => {
    if (el.tagName === "annotation") el.properties = { ...el.properties, dataZrIgnore: "" };
  });
  // Drop formatting whitespace between MathML elements (MathJax pretty-prints).
  visitParents(m, "element", (el: Element) => {
    if (el.tagName === "mi" || el.tagName === "mo" || el.tagName === "mn" || el.tagName === "mtext" || el.tagName === "ms" || el.tagName === "annotation") return;
    el.children = el.children.filter((c) => !(c.type === "text" && !c.value.trim()));
  });
  return m;
}

export interface RehypeMathOptions {
  math: MathConfig;
  /** Chapter file, used in warnings. */
  source?: string;
  warn?: (message: string) => void;
}

/**
 * rehype plugin: `<code class="language-math math-inline|math-display">` (from
 * remark-math or `rehypeMathDelimiters`) and ```` ```math ```` fences → MathML.
 * Display math becomes `<figure data-zr-math="display"><math display="block">`,
 * so it is its own block (bookmarks, progress).
 */
export function rehypeMath(options: RehypeMathOptions) {
  const warn = options.warn ?? ((m: string) => console.warn(`[zreader] ${m}`));
  const where = options.source ? `${options.source}: ` : "";
  return async (tree: Root) => {
    const hits: Array<{ code: Element; ancestors: Parents[]; display: boolean }> = [];
    visitParents(tree, "element", (el: Element, ancestors: Parents[]) => {
      if (el.tagName !== "code") return;
      const c = classes(el);
      const parent = ancestors[ancestors.length - 1];
      const inPre = parent?.type === "element" && parent.tagName === "pre";
      if (c.includes("math-display") || (c.includes("language-math") && inPre)) hits.push({ code: el, ancestors: [...ancestors], display: true });
      else if (c.includes("math-inline") || c.includes("language-math")) hits.push({ code: el, ancestors: [...ancestors], display: false });
    });
    if (!hits.length) return;
    const render = await getMathRenderer(options.math);

    for (const { code, ancestors, display } of hits) {
      const tex = textOf(code).trim();
      let math: Element | null = null;
      try {
        math = toMathElement(render(tex, display), tex, display);
      } catch (e) {
        warn(`${where}could not render math ${JSON.stringify(tex.slice(0, 60))}: ${(e as Error).message}`);
      }
      if (!math) {
        // Leave the TeX visible, marked as an error.
        code.properties = { ...code.properties, className: [...classes(code), "zr-math-error"] };
        warn(`${where}could not render math ${JSON.stringify(tex.slice(0, 60))}`);
        continue;
      }
      const parent = ancestors[ancestors.length - 1];
      if (display) {
        const figure: Element = { type: "element", tagName: "figure", properties: { dataZrMath: "display" }, children: [math] };
        // ```math / $$ blocks arrive as <pre><code>; replace the whole <pre>.
        const target = parent?.type === "element" && parent.tagName === "pre" ? parent : code;
        const holder = target === parent ? ancestors[ancestors.length - 2] : parent;
        if (holder && "children" in holder) {
          const kids = holder.children as ElementContent[];
          const i = kids.indexOf(target as ElementContent);
          // A display block alone in a <p> (HTML chapters) replaces the paragraph.
          if (holder.type === "element" && holder.tagName === "p" && kids.filter((k) => !(k.type === "text" && !k.value.trim())).length === 1) {
            holder.tagName = "figure";
            holder.properties = { dataZrMath: "display" };
            holder.children = [math];
          } else if (i >= 0) {
            kids[i] = holder.type === "element" && holder.tagName === "p" ? math : figure;
          }
        }
      } else if (parent && "children" in parent) {
        const kids = parent.children as ElementContent[];
        const i = kids.indexOf(code);
        if (i >= 0) kids[i] = math;
      }
    }
  };
}

// ------------------------------------------------------- HTML delimiters

const SKIP = new Set(["code", "pre", "script", "style", "textarea", "math", "svg", "kbd", "samp", "var"]);
const DELIMS = /\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g;

function mathCode(tex: string, display: boolean): Element {
  return { type: "element", tagName: "code", properties: { className: ["language-math", display ? "math-display" : "math-inline"] }, children: [{ type: "text", value: tex }] };
}

/**
 * rehype plugin for `.html` chapters: `\(…\)` (inline), `\[…\]` and `$$…$$`
 * (display) in text become math code elements for `rehypeMath`. Single `$` is
 * not a delimiter in HTML (too common in prose). Skips code, pre, kbd and
 * existing MathML.
 */
export function rehypeMathDelimiters() {
  return (tree: Root) => {
    const texts: Array<{ node: Text; parent: Parents }> = [];
    visitParents(tree, "text", (node: Text, ancestors: Parents[]) => {
      if (ancestors.some((a) => a.type === "element" && SKIP.has(a.tagName))) return;
      if (!/\\\(|\\\[|\$\$/.test(node.value)) return;
      texts.push({ node, parent: ancestors[ancestors.length - 1]! });
    });
    for (const { node, parent } of texts) {
      const out: ElementContent[] = [];
      let last = 0;
      for (const m of node.value.matchAll(DELIMS)) {
        const at = m.index!;
        if (at > 0 && node.value[at - 1] === "\\") continue; // escaped
        if (at > last) out.push({ type: "text", value: node.value.slice(last, at) });
        const inline = m[1];
        out.push(mathCode((inline ?? m[2] ?? m[3] ?? "").trim(), inline == null));
        last = at + m[0].length;
      }
      if (!out.length) continue;
      if (last < node.value.length) out.push({ type: "text", value: node.value.slice(last) });
      const kids = parent.children as ElementContent[];
      const i = kids.indexOf(node);
      if (i >= 0) kids.splice(i, 1, ...out);
    }
  };
}
