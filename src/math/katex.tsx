/**
 * `zreader/math/katex` — math in the scratchpad with KaTeX (`npm i katex`),
 * rendered as MathML like `content.math: "katex"`. KaTeX is loaded when the
 * scratchpad first needs it.
 *
 *   <ReaderRoot><ScratchpadMath />{children}</ReaderRoot>
 *   // or: <ReaderProvider math={loadMath}>
 */
import { makeScratchpadMath, withInlineStyle, type MathLoader, type PadMathOptions } from "./shared";

type KatexLike = { renderToString(tex: string, opts?: Record<string, unknown>): string };

export function createMathLoader(macros: Record<string, string> = {}, options: PadMathOptions = {}): MathLoader {
  return async () => {
    const mod = (await import("katex")) as unknown as { default?: KatexLike } & KatexLike;
    const katex = mod.default ?? mod;
    return withInlineStyle((tex, display) =>
      katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false, strict: "ignore", macros: { ...macros } }), options.inlineStyle);
  };
}

/** KaTeX with no macros. */
export const loadMath: MathLoader = createMathLoader();

/** Turns on scratchpad math with KaTeX. Render it inside `<ReaderRoot>` / `<ReaderProvider>`. */
export const ScratchpadMath = makeScratchpadMath(createMathLoader);
export { withInlineStyle } from "./shared";
export type { ScratchpadMathProps, PadMathOptions } from "./shared";
