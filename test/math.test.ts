import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { compileMdx, renderHtml, renderMarkdown, runMdx } from "../src/content/index";
import { MathEngineMissingError, getMathRenderer, resolveMath } from "../src/content/math";
import { resolveConfig } from "../src/config/index";
import { htmlToMarkdown, mdxToMarkdown } from "../src/agent/index";

const ENGINES = ["katex", "temml", "mathjax"] as const;
const quiet = { warn: () => {} };

describe("math is opt-in", () => {
  it("leaves $…$ as text when content.math is off", async () => {
    const r = await renderMarkdown("Inline $E=mc^2$.", { images: quiet });
    expect(r.html).toContain("$E=mc^2$");
    expect(r.html).not.toContain("<math");
  });

  it("still strips author MathML when math is off", async () => {
    const r = await renderHtml("<p>x <math><mi>y</mi></math></p>", { images: quiet });
    expect(r.html).not.toContain("<math");
  });

  it("validates content.math", () => {
    expect(() => resolveConfig({ content: { math: "latex" as never } })).toThrow(/content\.math/);
    expect(resolveConfig({ content: { math: "temml" } }).content.math).toBe("temml");
    expect(resolveMath({ engine: "katex", macros: { "\\RR": "\\mathbb{R}" } })).toEqual({ engine: "katex", macros: { "\\RR": "\\mathbb{R}" } });
    expect(resolveMath(false)).toBeNull();
  });
});

describe.each(ENGINES)("math with %s", (engine) => {
  const opts = { math: engine, images: quiet } as const;

  it("renders inline and display math in Markdown as MathML with a TeX annotation", async () => {
    const r = await renderMarkdown("Inline $E=mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\n```math\nx^2\n```", opts);
    expect(r.html).toMatch(/<p data-block-id="p-[0-9a-f]{6}">Inline <math><semantics>.*<annotation encoding="application\/x-tex" data-zr-ignore="">E=mc\^2<\/annotation><\/semantics><\/math> here\.<\/p>/);
    expect(r.html).toMatch(/<figure data-zr-math="display" data-block-id="figure-[0-9a-f]{6}"><math display="block"><semantics>.*<mfrac>/);
    expect(r.html).toContain('<annotation encoding="application/x-tex" data-zr-ignore="">\\frac{a}{b}</annotation>');
    expect(r.html).toContain('<annotation encoding="application/x-tex" data-zr-ignore="">x^2</annotation>');
    // No inline styles or engine classes survive.
    expect(r.html).not.toMatch(/style=|class="(katex|tml)/);
  });

  it("renders \\(…\\), \\[…\\] and $$…$$ in HTML chapters, but not inside code", async () => {
    const r = await renderHtml("<p>Area \\(\\pi r^2\\) and $5 or $6.</p><p>\\[a+b\\]</p><p>$$c$$</p><pre><code>\\(not math\\)</code></pre>", opts);
    expect(r.html).toMatch(/<p data-block-id="[^"]+">Area <math>.*<\/math> and \$5 or \$6\.<\/p>/);
    expect(r.html.match(/<figure data-zr-math="display"/g)).toHaveLength(2);
    expect(r.html).toContain("<code>\\(not math\\)</code>");
  });

  it("keeps author MathML in HTML chapters when math is on", async () => {
    const r = await renderHtml("<p>x <math><mi>y</mi><script>alert(1)</script></math></p>", opts);
    expect(r.html).toContain("<math><mi>y</mi></math>");
    expect(r.html).not.toContain("<script");
  });

  it("fixes the MDX {…} problem: braces inside $…$ are TeX, not JavaScript", async () => {
    const c = await compileMdx("Math $\\frac{a}{b}$ here.\n\n$$\nx^{2}\n$$", opts);
    const Content = await runMdx(c.code);
    const html = renderToStaticMarkup(createElement(Content));
    expect(html).toContain("<mfrac>");
    expect(html).toContain("\\frac{a}{b}</annotation>");
    expect(html).toContain('<math display="block">');
  });

  it("applies macros", async () => {
    const r = await renderMarkdown("$\\RR$", { math: { engine, macros: { "\\RR": "\\mathbb{R}" } }, images: quiet });
    expect(r.html).toMatch(/<mi[^>]*>(ℝ|R)<\/mi>/);
    expect(r.html).not.toMatch(/<(mtext|merror)/);
  });

  it("does not throw on invalid TeX", async () => {
    const r = await renderMarkdown("Bad $\\frac{a$ math.", opts);
    expect(r.html).toContain("Bad ");
    expect(r.html).toContain(" math.");
  });
});

describe("math in .md twins", () => {
  it("keeps $…$ in MDX twins, braces included", async () => {
    const md = await mdxToMarkdown("Math $\\frac{a}{b}$ here.\n\n$$\nx^{2}\n$$\n");
    expect(md).toContain("$\\frac{a}{b}$");
    expect(md).toContain("$$\nx^{2}\n$$");
  });

  it("turns MathML with a TeX annotation back into $…$ in HTML twins", async () => {
    const md = await htmlToMarkdown(
      '<p>Inline <math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math>.</p><math display="block"><semantics><mi>y</mi><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math>',
    );
    expect(md).toContain("Inline $x^2$.");
    expect(md).toContain("$$\n\\frac{a}{b}\n$$");
  });
});

describe("missing engine", () => {
  it("explains how to install it", () => {
    const e = new MathEngineMissingError("temml");
    expect(e.message).toBe('content.math = "temml" needs the temml package: npm i temml');
    expect(typeof getMathRenderer).toBe("function");
  });
});
