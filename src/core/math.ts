/**
 * Math in the browser (the scratchpad). Chapters are rendered on the server;
 * the pad needs an engine in the page, which the app provides, for example
 * with `<ScratchpadMath />` from `zreader/math/katex`.
 */

/** TeX → a MathML string. */
export type MathRenderer = (tex: string, display: boolean) => string;

/** Loads a renderer on first use, so the engine is only downloaded when the pad needs it. */
export type MathLoader = () => Promise<MathRenderer>;

const loaded = new WeakMap<MathLoader, Promise<MathRenderer>>();

/** Calls `loader` once and shares the result. */
export function loadMathRenderer(loader: MathLoader): Promise<MathRenderer> {
  let p = loaded.get(loader);
  if (!p) {
    p = loader();
    loaded.set(loader, p);
    p.catch(() => loaded.delete(loader));
  }
  return p;
}
