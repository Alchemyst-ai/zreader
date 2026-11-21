import { describe, expect, it } from "vitest";
import { createMathLoader as katexLoader } from "../src/math/katex";
import { createMathLoader as temmlLoader } from "../src/math/temml";

const TEX = "\\Sigma_{1}^{\\infty}\\frac{1}{n^2} = \\frac{\\pi^2}{6}";

describe.each([
  ["katex", katexLoader],
  ["temml", temmlLoader],
])("pad inline style with %s", (_name, create) => {
  it("renders inline formulas in display style by default, keeping the author's TeX", async () => {
    const render = await create()();
    const out = render(TEX, false);
    expect(out).toMatch(/<mstyle[^>]*displaystyle="true"/);
    expect(out).not.toMatch(/display="block"/);
    expect(out).toContain(`<annotation encoding="application/x-tex">${TEX.replace(/&/g, "&amp;")}</annotation>`);
  });

  it("leaves display formulas alone, and standard inline style with inlineStyle: \"text\"", async () => {
    const display = (await create()())(TEX, true);
    expect(display).toMatch(/display="block"/);
    const text = (await create({}, { inlineStyle: "text" })())(TEX, false);
    expect(text).not.toMatch(/displaystyle="true"/);
  });
});
