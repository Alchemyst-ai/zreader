# Styling

The UI is built from [shadcn/ui](https://ui.shadcn.com) components and Tailwind classes. Pick **one** stylesheet.

## Without Tailwind: `zreader/styles.css`

```ts
import "zreader/styles.css";
```

- Precompiled and unlayered: it works next to any CSS, with no build step.
- No global preflight: a reset is scoped to the reader and its overlays, so your site's element styles don't leak in and the reader's don't leak out.
- Theme tokens are namespaced as `--zr-*`, so they never clash with your variables. Override them in your own CSS:

```css
:root {
  --zr-primary: oklch(0.45 0.18 260);
  --zr-radius: 0.5rem;
  --zr-font-serif: "Literata", Georgia, serif;
}
.dark {
  --zr-background: oklch(0.16 0 0);
}
```

Tokens: `--zr-background`, `--zr-foreground`, `--zr-card`, `--zr-card-foreground`, `--zr-popover`, `--zr-popover-foreground`, `--zr-primary`, `--zr-primary-foreground`, `--zr-secondary`, `--zr-secondary-foreground`, `--zr-muted`, `--zr-muted-foreground`, `--zr-accent`, `--zr-accent-foreground`, `--zr-destructive`, `--zr-border`, `--zr-input`, `--zr-ring`, `--zr-radius`, `--zr-font-serif`, `--zr-font-sans`, `--zr-font-mono`, and the highlight colours `--zr-hl-yellow`, `--zr-hl-green`, `--zr-hl-blue`, `--zr-hl-pink`, `--zr-hl-purple`, `--zr-hl-orange`, `--zr-hl-active`.

## With Tailwind v4 and shadcn: `zreader/tailwind.css`

```css
@import "tailwindcss";
@import "zreader/tailwind.css";
```

- Your own shadcn tokens (`--background`, `--primary`, …) style the reader, so it matches your app.
- The file tells Tailwind to scan the package's compiled components (`@source`), including `zreader/agent/react`, and adds the typography plugin, a sepia theme in your token names, and the reader's highlight rules.

## Themes

`ReaderProvider` renders a [`next-themes`](https://github.com/pacocoursey/next-themes) `ThemeProvider` (a plain React library, despite the name). It sets `light`, `dark` or `sepia` as a class on `<html>`, follows the system setting for `system`, and prevents a flash of the wrong theme on load. The choice is stored under `<storagePrefix>:v1:theme`.

- Offer fewer themes with `reader.themes`, and set the default with `reader.defaultTheme`.
- If your app already renders a `ThemeProvider`, pass `manageTheme={false}` and add a `sepia` class to your own theme list if you want it.
- In client-only React apps, React logs "Encountered a script tag while rendering React component" once, from `next-themes`' anti-flash script. It's harmless; `manageTheme={false}` with your own theme setup avoids it.

## Reading settings

Text size, line spacing, line width and font are Tailwind classes on the article, from exported maps you can reuse: `TEXT_SIZE_CLASS` (`prose-sm` … `prose-2xl`), `LEADING_CLASS`, `MEASURE_CLASS` (`max-w-[58ch]`, `[68ch]`, `[82ch]`) and `FONT_CLASS` (`font-serif`, `font-sans`, `font-mono`). Chapter content is styled with Tailwind Typography (`PROSE_CLASS`).

## Hooks for your CSS

| Selector | Element |
| --- | --- |
| `[data-zr-reader]` | The reader root |
| `[data-zr-copy-reference]` | The Copy reference button group |
| `[data-zr-ignore]` | Elements excluded from highlighting (e.g. `Callout`) |
| `[data-block-id]` | Every highlightable block |
| `.zr-editor` | The scratchpad editor |
| `[data-slot="…"]` | shadcn component parts (`button`, `dropdown-menu-content`, …) |
| `::highlight(zr-<colour>)`, `::highlight(zr-active)` | Painted highlights |

## Mobile

The reader is mobile-first. Make sure your page has `<meta name="viewport" content="width=device-width, initial-scale=1">` (Next.js adds it for you); without it, phones render the desktop layout. The top bar respects `env(safe-area-inset-top)`.
