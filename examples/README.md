# Examples

Two complete apps using this checkout of zreader. Each depends on it with `"zreader": "file:../.."` (copied, not symlinked, through `install-links=true` in its `.npmrc`), so build the package first:

```sh
# at the repo root
npm install
npm run build

# then, in an example
cd examples/next-shadcn   # or examples/vite-shadcn
npm install
npm run dev
```

After you change and rebuild zreader, refresh the example's copy: `rm -rf node_modules/zreader && npm install`.

| Example | Stack | Shows |
| --- | --- | --- |
| [`next-shadcn`](./next-shadcn) | Next.js 16, Tailwind v4, shadcn/ui | The Next.js adapter: `content/books/` with a Markdown, an MDX and an HTML chapter, images next to chapters through `next/image`, a remote image, base64, KaTeX math, the agent proxy (`.md` twins, `llms.txt`, `_assets`), offline reading |
| [`vite-shadcn`](./vite-shadcn) | Vite 7, React Router 7, Tailwind v4, shadcn/ui | The React path: a catalogue built from `import.meta.glob`, MDX chapters compiled by Vite with zreader's `rehypeImages`, `rehypeMath` and `rehypeBlocks`, images from `public/`, React Router links |

Both style the reader with their own shadcn tokens through `zreader/tailwind.css`. Highlights, notes, bookmarks, the scratchpad (with pasted images) and the image viewer work in both.

Open `http://localhost:3000/books` (Next.js) or `http://localhost:5173/books` (Vite).
