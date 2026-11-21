// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/content/index";
import { buildTextIndex, createMemoryAdapter, createReaderStore, describeSpan, highlightToMarkdown, highlightText, spanToText } from "../src/core/index";

async function chapter(md: string) {
  const { html } = await renderMarkdown(md, { math: "katex", images: { warn: () => {} } });
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return buildTextIndex(root);
}

describe("quotes keep TeX", () => {
  it("writes inline and display formulas as $TeX$, whole, once", async () => {
    const index = await chapter("Energy is $E=mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter.");
    expect(index.text).not.toContain("E=mc^2"); // the rendered text has no TeX
    const all = spanToText(index, { start: 0, end: index.text.length });
    expect(all).toBe("Energy is $E=mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter.");
    // A selection that ends inside a formula still quotes the whole formula.
    const start = index.text.indexOf("is");
    const partial = spanToText(index, { start, end: index.text.indexOf("here") - 3 });
    expect(partial).toBe("is $E=mc^2$");
  });

  it("is stored on the highlight and used for the scratchpad quote", async () => {
    const index = await chapter("Energy is $E=mc^2$ here.");
    const span = { start: 0, end: index.text.length };
    const store = createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });
    const h = store.addHighlight({ bookId: "b", chapterId: "c", anchor: describeSpan(index, span)!, text: spanToText(index, span) });
    expect(h.text).toBe("Energy is $E=mc^2$ here.");
    expect(highlightToMarkdown(h)).toBe("> Energy is $E=mc^2$ here.");
    // Plain passages don't store a copy.
    const plain = store.addHighlight({ bookId: "b", chapterId: "c", anchor: { ...h.anchor, exact: "x" }, text: "x" });
    expect(plain.text).toBeUndefined();
    expect(highlightText(plain)).toBe("x");
  });
});
