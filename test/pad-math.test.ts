// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { createMemoryAdapter, createReaderStore } from "../src/core/index";
import { jsonHasMath, markdownHasMath, mathExtensions } from "../src/editor/math";
import { loadMath as katex } from "../src/math/katex";
import { loadMath as temml } from "../src/math/temml";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = "Energy $E=mc^2$ costs $5 or $6.\n\n$$\n\\frac{a}{b}\n$$\n\n> Quoted\n>\n> $$\n> x^2\n> $$";

function headless(md: string, math: boolean) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, Markdown.configure({ marked: new Marked() as never }), ...(math ? mathExtensions(katex) : [])],
    content: md,
    contentType: "markdown",
  });
}

describe("scratchpad math: Markdown", () => {
  it("parses $…$ and $$…$$ (also inside quotes) and writes them back", () => {
    const ed = headless(SOURCE, true);
    const json = ed.getJSON();
    expect(jsonHasMath(json)).toBe(true);
    const types: string[] = [];
    ed.state.doc.descendants((n) => void (n.type.name.endsWith("Math") && types.push(`${n.type.name}:${n.attrs.tex}`)));
    expect(types).toEqual(["inlineMath:E=mc^2", "blockMath:\\frac{a}{b}", "blockMath:x^2"]);
    const md = ed.getMarkdown();
    expect(md).toContain("Energy $E=mc^2$ costs $5 or $6.");
    expect(md).toContain("$$\n\\frac{a}{b}\n$$");
    expect(md).toMatch(/> \$\$\n> x\^2\n> \$\$/);
    ed.destroy();
  });

  it("leaves dollars alone when math is off, even after a math editor (no leaked tokenizers)", () => {
    headless(SOURCE, true).destroy();
    const ed = headless(SOURCE, false);
    expect(jsonHasMath(ed.getJSON())).toBe(false);
    expect(ed.getMarkdown()).toContain("Energy $E=mc^2$ costs $5 or $6.");
    ed.destroy();
  });

  it("detects math in Markdown, but not prices", () => {
    expect(markdownHasMath("a $x$ b")).toBe(true);
    expect(markdownHasMath("> $$\n> y\n> $$")).toBe(true);
    expect(markdownHasMath("costs $5 or $6")).toBe(false);
    expect(markdownHasMath("no math")).toBe(false);
  });
});

describe("scratchpad math: rendering", () => {
  it.each([
    ["katex", katex],
    ["temml", temml],
  ])("renders formulas as MathML with %s", async (_name, loader) => {
    const r = await loader();
    expect(r("x^2", false)).toMatch(/<math[\s\S]*<msup>/);
  });

  it("shows rendered formulas in the editor when the provider has a math loader, and edits on click", async () => {
    const { ReaderProvider } = await import("../src/react/index");
    const { ScratchpadEditor } = await import("../src/editor/index");
    const store = createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });
    const scope = { kind: "global" } as const;
    store.savePad(scope, "Energy $E=mc^2$.\n\n$$\n\\frac{a}{b}\n$$");
    const mount = async (math?: typeof katex) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      await act(async () => root.render(h(ReaderProvider, { store, math, manageTheme: false, toaster: false, children: h(ScratchpadEditor, { scope }) })));
      await act(async () => new Promise((r) => setTimeout(r, 80)));
      return { el, root };
    };

    const on = await mount(katex);
    const formulas = on.el.querySelectorAll(".zr-pad-math");
    expect(formulas).toHaveLength(2);
    expect(formulas[0]!.querySelector("math")).not.toBeNull();
    expect(formulas[1]!.getAttribute("data-display")).toBe("block");
    expect(on.el.querySelector('button[aria-label="Insert formula"]')).not.toBeNull();
    await act(async () => (formulas[0] as HTMLElement).click());
    const input = on.el.querySelector("input.zr-pad-math-input") as HTMLInputElement;
    expect(input.value).toBe("E=mc^2");
    await act(async () => root(on).unmount());

    const off = await mount();
    expect(off.el.querySelectorAll(".zr-pad-math")).toHaveLength(0);
    expect(off.el.textContent).toContain("$E=mc^2$");
    expect(off.el.querySelector('button[aria-label="Insert formula"]')).toBeNull();
    await act(async () => root(off).unmount());
  });
});

function root(m: { root: ReturnType<typeof createRoot> }) {
  return m.root;
}

describe("scratchpad math: typing", () => {
  function type(ed: Editor, text: string) {
    for (const ch of text) {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp("handleTextInput", (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
    }
  }
  const kinds = (ed: Editor) => {
    const out: string[] = [];
    ed.state.doc.descendants((n) => void (n.type.name.endsWith("Math") && out.push(`${n.type.name}:${n.attrs.tex}`)));
    return out;
  };

  it("turns $x$ into inline math, $$ + space into a display formula, and leaves prices alone", () => {
    const ed = headless("", true);
    ed.commands.focus("end");
    type(ed, "Area $\\pi r^2$ costs $5 or $6.");
    expect(kinds(ed)).toEqual(["inlineMath:\\pi r^2"]);
    expect(ed.getMarkdown()).toContain("Area $\\pi r^2$ costs $5 or $6.");
    ed.commands.enter();
    type(ed, "$$ ");
    expect(kinds(ed)).toEqual(["inlineMath:\\pi r^2", "blockMath:"]);
    ed.destroy();
  });
});
