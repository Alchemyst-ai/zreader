# Math

zreader renders TeX math as **MathML**, which every current browser draws natively. Math is off by default. Turn it on by picking an engine:

```ts
// reader.config.ts
export default defineConfig({
  content: { math: "katex" }, // or "temml", or "mathjax"
});
```

Then install that engine. It's an optional dependency, loaded only when selected:

| `content.math` | Install | Notes |
| --- | --- | --- |
| `"katex"` | `npm i katex` | Fast and widely used. Rendered with `output: "mathml"` |
| `"temml"` | `npm i temml` | Small, MathML-first, KaTeX-compatible syntax |
| `"mathjax"` | `npm i @mathjax/src` | The most complete TeX support. MathJax 4, TeX → MathML |

If the engine isn't installed, compiling a chapter that contains math fails with `content.math = "temml" needs the temml package: npm i temml`.

All three produce the same kind of output: a `<math>` element with the TeX source in a hidden `<annotation encoding="application/x-tex">`. Because the output is MathML, you don't need the engine's CSS or fonts, and the sanitizer never has to allow inline styles. Switching engines is a config change; cached chapters recompile.

## Writing math

**Markdown and MDX** (`remark-math`):

```md
Inline: $E = mc^2$.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

```math
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
```
```

For display math, put the `$$` delimiters on their own lines, as above. `$$x$$` inside a line of text is inline math.

In MDX, `{…}` is normally a JavaScript expression, so `$\frac{a}{b}$` used to crash the page with `a is not defined`. With math on, everything between the dollar signs is TeX.

**HTML chapters:** `\(…\)` for inline math, `\[…\]` or `$$…$$` for display math. A single `$` isn't a delimiter in HTML, because prose uses it for prices. Text inside `<code>`, `<pre>`, `<kbd>` and existing `<math>` is left alone, as is a delimiter preceded by another backslash.

**MathML you write yourself** (`<math>…</math>`) is kept in `.md` and `.html` chapters while math is on, using DOMPurify's MathML profile. When math is off it's removed, as before.

## Options

```ts
content: {
  math: {
    engine: "katex",
    macros: { "\\RR": "\\mathbb{R}", "\\NN": "\\mathbb{N}" },
    options: { /* passed to the engine */ },
  },
}
```

| Option | |
| --- | --- |
| `engine` | `"katex"`, `"temml"` or `"mathjax"` |
| `macros` | TeX macros shared by every engine, written with the backslash (`"\\RR"`). zreader adapts them for MathJax. Macros with arguments (`#1`) work in KaTeX and Temml; for MathJax, define them with `\newcommand` in the chapter |
| `options` | Engine options: KaTeX or Temml `renderToString` options, or MathJax TeX input options. zreader always sets the output to MathML and the display mode |

Invalid TeX never fails the build. With KaTeX and Temml the TeX source stays on the page as `<code class="zr-math-error">` (red) and a warning names the chapter; MathJax shows its error message inside the formula.

MathJax loads these TeX packages: `base`, `ams`, `newcommand`, `configmacros`, `noundefined`, `boldsymbol`, `braket`, `cancel`, `cases`, `color` and `mathtools`.

## Writing tips

- `\sum_{n=1}^{\infty}` is the summation sign: in display math it's drawn large with its limits above and below. `\Sigma` is the Greek letter and stays letter-sized.
- In chapters, inline fractions are compact, as in TeX. Use `\dfrac{1}{n^2}` or `$$…$$` for a full-size one.

## In the reader

- **Display math** is placed in `<figure data-zr-math="display">`, centred, and scrolls sideways when it's wider than the page.
- **Bookmarks and progress:** each display formula is its own block, so you can bookmark it and resume reading at it.
- **Highlights** can cover math, like any other text. Anchoring uses the rendered characters (the TeX annotation is marked `data-zr-ignore`), but what readers see and take away keeps the TeX: a highlight over $E = mc^2$ is listed, copied, exported and quoted to the scratchpad as `$E=mc^2$`, and display math as a `$$` block. A selection that ends inside a formula takes the whole formula. The Markdown is stored on the highlight as `text`; `highlightText(h)` returns it (or `anchor.exact` when the passage has no math).
- **Fonts:** math uses the `--zr-math-font` CSS variable, falling back to `Latin Modern Math`, `STIX Two Math`, `Cambria Math` and then the browser's `math` font. To use a particular font, load it yourself and set the variable:

  ```css
  :root { --zr-math-font: "Latin Modern Math"; }
  ```

  Temml publishes `Temml.woff2` and Latin Modern fonts you can serve for this.

## In the scratchpad

Chapter math is rendered on the server; the scratchpad runs in the browser, so it needs an engine in the page. Turn it on with KaTeX or Temml (the same package you use for `content.math`):

```tsx
// Next.js: app/books/layout.tsx
import { ScratchpadMath } from "zreader/math/katex"; // or "zreader/math/temml"

<ReaderRoot>
  <ScratchpadMath macros={{ "\\RR": "\\mathbb{R}" }} />
  {children}
</ReaderRoot>
```

```tsx
// Plain React
import { loadMath } from "zreader/math/katex";

<ReaderProvider books={books} math={loadMath}>…</ReaderProvider>
```

The engine is loaded the first time a pad shows a formula, so readers who never use math in the pad don't download it (KaTeX is about 78 KB gzipped, Temml less). For a site that renders chapters with MathJax, use Temml in the pad: MathJax is too large to send to every reader. Formulas can then look slightly different in the pad.

With it on:

- `$…$` and `$$…$$` in a pad render as formulas, including math quoted from a chapter (inside the quote, too).
- Type `$x^2$` for an inline formula, or `$$` and a space on an empty line for a display one. The **Σ** button inserts a formula (from the selected text, if any).
- Click a formula, or select it and press Enter, to edit its TeX. Enter (Ctrl/⌘+Enter for display math) saves, Escape cancels, and an empty formula is removed.
- Pads are still stored as Markdown with `$…$`, so downloads and backups are unchanged.
- A dollar sign followed by a space, or a closing one followed by a digit, isn't math: `$5 or $6` stays text.
- **Size:** inline formulas are typeset in display style, so fractions, limits and sums are full size next to the pad's small text: `$\frac{1}{n^2}$` reads like `$$…$$`, only inline. Lines with fractions get a little taller. Only the rendering changes; the TeX you wrote is what's stored and edited. Pass `<ScratchpadMath inlineStyle="text" />` (or `createMathLoader(macros, { inlineStyle: "text" })`) for standard TeX inline sizing.
- **Letter height:** math fonts have short lowercase letters for their size, so a formula can look a size smaller than the words around it. In the pad, `font-size-adjust` scales the math font to match. Tune it with CSS variables on `.zr-editor`:

  ```css
  .zr-editor {
    --zr-math-scale: 1.1;      /* every pad formula 10% larger */
    --zr-math-x-height: none;  /* turn off the letter-height matching */
  }
  ```

  Chapters keep their own sizing (`1.05em`), so these variables don't change chapter math.

Without it, the pad shows `$…$` as plain text, as before. `useRegisterMath(loader)` and `useMathLoader()` from `zreader/react` let you register your own renderer (`(tex, display) => MathML`).

## In the `.md` twin

- `.md` chapters: the source as written, so `$…$` and `$$…$$` are unchanged.
- `.mdx` chapters: math is parsed before MDX expressions, so `$\frac{a}{b}$` survives the conversion with its braces.
- `.html` chapters: `<math>` with a TeX annotation becomes `$tex$` or `$$tex$$`. MathML without one becomes its text. `\(…\)` in the source is kept as written.

## Next.js

`withReader()` keeps `@mathjax/src` external on the server, as it does for DOMPurify. KaTeX and Temml need no setup. Math is rendered while chapters are compiled, on the server, so no math JavaScript is sent to the browser.
