import type { FontFamily, HighlightColor, Leading, Measure, TextSize } from "zreader";

/**
 * Settings → literal Tailwind classes. Keeping every class as a full string
 * literal lets Tailwind see them at build time; nothing is styled inline.
 */
export const TEXT_SIZE_CLASS: Record<TextSize, string> = {
  sm: "prose-sm",
  base: "prose-base",
  lg: "prose-lg",
  xl: "prose-xl",
  "2xl": "prose-2xl",
};

export const LEADING_CLASS: Record<Leading, string> = {
  tight: "prose-p:leading-snug prose-li:leading-snug",
  normal: "prose-p:leading-normal prose-li:leading-normal",
  relaxed: "prose-p:leading-relaxed prose-li:leading-relaxed",
};

export const MEASURE_CLASS: Record<Measure, string> = {
  narrow: "max-w-[58ch]",
  normal: "max-w-[68ch]",
  wide: "max-w-[82ch]",
};

export const FONT_CLASS: Record<FontFamily, string> = {
  serif: "font-serif",
  sans: "font-sans",
  mono: "font-mono",
};

export const SWATCH_CLASS: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300 dark:bg-yellow-400/70",
  green: "bg-green-300 dark:bg-green-400/60",
  blue: "bg-sky-300 dark:bg-sky-400/60",
  pink: "bg-pink-300 dark:bg-pink-400/60",
  purple: "bg-violet-300 dark:bg-violet-400/60",
  orange: "bg-orange-300 dark:bg-orange-400/60",
};

export const QUOTE_BORDER_CLASS: Record<HighlightColor, string> = {
  yellow: "border-yellow-400",
  green: "border-green-400",
  blue: "border-sky-400",
  pink: "border-pink-400",
  purple: "border-violet-400",
  orange: "border-orange-400",
};

export function swatchClass(color: string): string {
  return SWATCH_CLASS[color as HighlightColor] ?? SWATCH_CLASS.yellow;
}

export function quoteBorderClass(color: string): string {
  return QUOTE_BORDER_CLASS[color as HighlightColor] ?? QUOTE_BORDER_CLASS.yellow;
}

/** Shared typography for chapter content: shadcn tokens via typography modifiers. */
export const PROSE_CLASS =
  "prose max-w-none text-foreground prose-headings:text-foreground prose-headings:scroll-mt-20 prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-a:text-primary prose-a:underline-offset-4 prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-code:text-foreground prose-pre:bg-muted prose-pre:text-foreground prose-hr:border-border prose-th:text-foreground prose-td:text-foreground prose-figcaption:text-muted-foreground prose-img:rounded-lg prose-table:block prose-table:max-w-full prose-table:overflow-x-auto prose-th:align-bottom prose-td:align-top";
