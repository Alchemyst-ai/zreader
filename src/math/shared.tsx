import { useMemo } from "react";
import type { MathLoader, MathRenderer } from "zreader";
import { useRegisterMath } from "zreader/react";

export interface PadMathOptions {
  /**
   * How inline formulas (`$…$`) are typeset in the pad. `"display"` (default)
   * renders them in display style, so fractions, sums and limits are full size
   * next to the pad's small text. `"text"` is standard TeX inline style.
   * Only the rendering changes: the stored TeX is untouched.
   */
  inlineStyle?: "display" | "text";
}

export interface ScratchpadMathProps extends PadMathOptions {
  /** TeX macros, written with the backslash: `{ "\\RR": "\\mathbb{R}" }`. Use the same ones as `content.math`. */
  macros?: Record<string, string>;
}

/** Applies `inlineStyle` to a renderer. */
export function withInlineStyle(render: MathRenderer, inlineStyle: PadMathOptions["inlineStyle"] = "display"): MathRenderer {
  if (inlineStyle === "text") return render;
  return (tex, display) => {
    if (display) return render(tex, true);
    // Typeset as display style, but keep the author's TeX in the annotation.
    const out = render(`\\displaystyle ${tex}`, false);
    return out.replace(/(<annotation encoding="application\/x-tex">)\\displaystyle /, "$1");
  };
}

/** A component that turns on scratchpad math with `create(macros, options)` while mounted. Renders nothing. */
export function makeScratchpadMath(create: (macros: Record<string, string>, options?: PadMathOptions) => MathLoader) {
  return function ScratchpadMath({ macros, inlineStyle = "display" }: ScratchpadMathProps) {
    const key = JSON.stringify(macros ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loader = useMemo(() => create(JSON.parse(key) as Record<string, string>, { inlineStyle }), [key, inlineStyle]);
    useRegisterMath(loader);
    return null;
  };
}

export type { MathLoader, MathRenderer };
