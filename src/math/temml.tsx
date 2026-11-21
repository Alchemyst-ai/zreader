/**
 * `zreader/math/temml` — math in the scratchpad with Temml (`npm i temml`),
 * rendered as MathML like `content.math: "temml"`. Temml is loaded when the
 * scratchpad first needs it. Also the lightest choice for a site that renders
 * chapters with MathJax.
 *
 *   <ReaderRoot><ScratchpadMath />{children}</ReaderRoot>
 *   // or: <ReaderProvider math={loadMath}>
 */
import { makeScratchpadMath, withInlineStyle, type MathLoader, type PadMathOptions } from "./shared";

export function createMathLoader(macros: Record<string, string> = {}, options: PadMathOptions = {}): MathLoader {
  return async () => {
    const mod = (await import("temml")) as { default?: unknown };
    const temml = (mod.default ?? mod) as { renderToString(tex: string, opts?: Record<string, unknown>): string };
    return withInlineStyle((tex, display) => temml.renderToString(tex, { displayMode: display, throwOnError: false, annotate: true, macros: { ...macros } }), options.inlineStyle);
  };
}

/** Temml with no macros. */
export const loadMath: MathLoader = createMathLoader();

/** Turns on scratchpad math with Temml. Render it inside `<ReaderRoot>` / `<ReaderProvider>`. */
export const ScratchpadMath = makeScratchpadMath(createMathLoader);
export { withInlineStyle } from "./shared";
export type { ScratchpadMathProps, PadMathOptions } from "./shared";
