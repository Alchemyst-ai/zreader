# Runnable code

Readers can add **RunnableCode** to any scratchpad: Python, JavaScript or TypeScript that they run in place, with the **Output** of the last run shown under it and saved in the pad. Variables carry over between runs in the same pad, like a notebook.

Authors can put RunnableCode in chapters too, with the same syntax. Readers run it where they read it, edit it to try their own changes, and copy it into their scratchpad to keep (see [In chapters](#in-chapters)).

Code runs in the reader's own browser, so no server is needed. It can't read the page, the reader's other notes or highlights, or reach the internet, unless you grant it in `reader.config.ts`.

RunnableCode is off until you turn it on. Without it, pads and chapters that contain RunnableCode show it as plain code blocks.

> The original idea was code that runs only "if the instance is connected to the backend". The browser Sandbox replaces that as the default ([ADR 0001](./adr/0001-browser-sandbox-by-default.md)). A server Sandbox that takes over where you enable it is planned ([#16](https://github.com/Alchemyst-ai/zreader/issues/16)).

## Turn it on

Render `<ScratchpadSandbox />` inside the provider:

```tsx
// app/books/layout.tsx (Next.js)
import { ReaderRoot } from "zreader/next/server";
import { ScratchpadSandbox } from "zreader/sandbox/browser";

export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReaderRoot>
      <ScratchpadSandbox />
      {children}
    </ReaderRoot>
  );
}
```

Or pass a Sandbox to the provider:

```tsx
import { browserSandbox } from "zreader/sandbox/browser";

const sandbox = browserSandbox(); // module level: a new one restarts every Kernel

<ReaderProvider books={books} sandbox={sandbox}>…</ReaderProvider>
```

The scratchpad toolbar then has an **Insert runnable code** button. Readers pick a language, write code, and press **Run** or Shift+Enter.

## Languages

| Language | Runs with | You install |
| --- | --- | --- |
| Python | [Pyodide](https://pyodide.org) (CPython in WebAssembly), loaded from jsDelivr on the first Python run (about 10 MB) | Nothing |
| JavaScript | A worker; code is rewritten with `acorn` (a zreader dependency, loaded on the first run) | Nothing |
| TypeScript | Types are stripped with `sucrase`, then it runs as JavaScript | `npm i sucrase`, and opt in (below) |

TypeScript is opt in, so sites that don't use it never resolve `sucrase`:

```tsx
"use client";
import { ScratchpadSandbox } from "zreader/sandbox/browser";

export function Sandbox() {
  return <ScratchpadSandbox typescript={() => import("sucrase")} />;
}
```

A function can't be passed from a server component, so under Next.js put this in a client component, as above.

What readers get:

- **Variables carry over** between runs in the same pad and language. JavaScript `const` and `let` can be declared again in a later run.
- **The last expression is shown**, as in a notebook: `x + 1` on the last line prints its value without `print`.
- **Top-level `await`** works in Python and JavaScript. JavaScript `import … from "url"` works if the site grants network access to that origin.
- **Packages Pyodide ships** (numpy, pandas, matplotlib and [many more](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)) can be imported without any permission. Other packages need `packages` (see [Dangerous permissions](#dangerous-permissions)).
- **Images:** a matplotlib figure left open at the end of a run is shown under the code. In JavaScript, `await display(canvas)` shows an `OffscreenCanvas`, an image `Blob` or an image data URL.
- **Stop** ends a run. Browsers can't interrupt a run and keep its variables, so Stop restarts the **Kernel** (the interpreter holding the pad's state) and says its variables were cleared ([ADR 0003](./adr/0003-no-cross-origin-isolation-stop-restarts-kernel.md)). A run that takes longer than the run timeout is stopped the same way. Stop on RunnableCode still waiting for the Kernel (behind another run in the same pad) just cancels it.
- Each pad has one Kernel per language, per browser tab. A Kernel with no run for 15 minutes is shut down, and the next run says so.

## How it is stored

RunnableCode is a fenced code block with `run` and an id. Its Output is an `output` fence pointing back at it, and images it displayed follow as image references:

````md
```python run id=k3x9
import matplotlib.pyplot as plt
plt.plot([1, 3, 2])
total = 41
total + 1
```
```output for=k3x9
42
```
![output](zr-blob:9f2c3e…)
````

- The Output holds only text: no status or timing, so running unchanged code doesn't change the pad ([ADR 0002](./adr/0002-outputs-stored-in-pad-markdown.md)).
- Output longer than about 8,000 characters is cut in the pad and ends with `… [output truncated]`.
- Images are kept with [reader images](./reader-features.md#reader-images) (IndexedDB, subject to `reader.userImages`), so they're included in backups and cleaned up by **Remove unused images** once a run replaces them. With `userImages.enabled: false` they're shown but not kept.
- When the code changes after a run, its Output is dimmed and marked as from an older version of the code.
- Exported pads read as ordinary Markdown. Where there's no Sandbox, both fences show as code blocks and are kept unchanged.

## In chapters

Write RunnableCode in a Markdown or MDX chapter exactly as in a pad. An `output` fence right after it is the Output readers see before they run anything:

````md
```python run id=squares
squares = [n * n for n in range(1, 6)]
squares
```
```output for=squares
[1, 4, 9, 16, 25]
```
````

The `id` pairs the code with its Output. Without one, the Output fence must come straight after the code and name no id, and zreader derives an id from the code.

In MDX you can also use the component, which takes the code as a prop:

```mdx
<RunnableCode language="python" id="total" code={"sum(squares)"} output="55" />
```

`RunnableCode` is in Next's default MDX components (`mdxComponents` from `zreader/next/server`). Elsewhere, import it from `zreader/react` and pass it in your MDX `components`. HTML chapters don't get RunnableCode: the markers are removed when HTML is sanitized.

What readers get:

- **Nothing runs on its own.** The page shows the author's code and Output as ordinary code blocks, and a bar with **Run**, **Edit**, **Copy to pad** and **Restart**.
- **Examples on one page share a Kernel** per language, so later examples can use what earlier ones defined. That Kernel is separate from the reader's pads, and it ends when the reader leaves the page.
- **Edit** opens the code in an editor; Shift+Enter runs it and **Reset** brings back the author's version. Edits and the reader's Output last as long as the page.
- **Copy to pad** appends the code, with the Output of that exact code, to the chapter's scratchpad, where it's saved like any RunnableCode.
- The author's code keeps its block id, so highlights and bookmarks work on it. While the reader edits it, the author's code (and any highlights on it) is hidden until Reset.
- A language the Sandbox doesn't run stays a plain code block.

Under Next.js and with the content layer this works with no setup beyond the Sandbox. If you compile MDX yourself (Vite's `@mdx-js/rollup`, for example), add `rehypeRunnable` from `zreader/content` as the **first** rehype plugin, so it sees the fences' info strings. A rehype plugin that rebuilds `pre` elements (a syntax highlighter) after it drops the markers.

The `.md` twins agents read show RunnableCode as plain fences (` ```python `, then ` ```text ` for the Output).

> Chapter code currently runs with the **scratchpad's** Dangerous permissions. Per-chapter rules, so only the chapters you choose get network access or pinned packages, are next ([#19](https://github.com/Alchemyst-ai/zreader/issues/19)). Until then, leave `permissions.scratchpad` empty on shelves whose authors you don't trust.

## Configuration

`reader.sandbox` in `reader.config.ts`, set for the whole site and overridden per shelf through the shelf's `reader`. These settings only limit RunnableCode; they can't turn it on.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `sandbox.scopes.global` / `.book` / `.chapter` | `"browser"` or `false` | `"browser"` | Where RunnableCode in that kind of pad runs. `false` shows it as plain code and hides the toolbar button |
| `sandbox.chapters` | `"browser"` or `false` | `"browser"` | Where RunnableCode the author wrote in chapters runs. `false` shows it as plain code. Not the same as `scopes.chapter`, which is the reader's chapter pad |
| `sandbox.kernel.idleTimeoutMs` | number or `false` | 15 minutes | Shut down a Kernel with no run for this long. `0` or `false`: never |
| `sandbox.kernel.runTimeoutMs` | number ≥ 100 or `false` | 30 seconds | Stop a run that takes longer. Counted from when the code starts, not while the runtime downloads |
| `sandbox.permissions.scratchpad.dangerousPermissions` | object | `{}` | See below |

```ts
export default defineConfig({
  reader: {
    sandbox: {
      scopes: { global: false }, // no RunnableCode in the "All books" pad
      kernel: { idleTimeoutMs: 10 * 60_000 },
    },
  },
  bookshelves: [
    { id: "books", basePath: "/books" },
    {
      id: "lab",
      basePath: "/lab",
      reader: { sandbox: { kernel: { runTimeoutMs: false } } },
    },
  ],
});
```

Options passed to `browserSandbox()` or `<ScratchpadSandbox />` (`runTimeoutMs`, `idleTimeoutMs`) win over these.

## Dangerous permissions

By default code can't reach the network or install packages. Only the site owner can grant either, in `reader.config.ts`. Books and readers can't.

```ts
reader: {
  sandbox: {
    permissions: {
      scratchpad: {
        dangerousPermissions: {
          network: ["https://api.example.com", "https://esm.sh"], // or true for any origin
          packages: ["rich", "tabulate"], // Python packages micropip may install
        },
      },
    },
  },
},
```

- **`network`**: origins (`https://host`, `https://*.host`, with a port if needed) that `fetch` and JavaScript imports may reach, or `true` for any. The Content-Security-Policy of the Sandbox frames allows exactly these (the Python frame also allows the origin Pyodide loads from).
- **`packages`**: names `micropip.install` may install, checked by name ([ADR 0005](./adr/0005-chapter-packages-pinned-and-csp-enforced.md)). Granting any adds `pypi.org` and `files.pythonhosted.org` to the policy, so their dependencies install too. Pinning to exact files is planned for code written by book authors, where trust matters more.
- When a request or install is blocked, the reader sees a message saying this site's permissions blocked it and naming the setting.
- Python can always reach the origin Pyodide is loaded from, because Pyodide loads its own files from there.

## Isolation

Every Kernel runs in a worker inside a hidden `<iframe sandbox="allow-scripts">` created from `srcdoc`, which gives it an opaque origin. Python gets one frame, and JavaScript and TypeScript another, so each frame's policy allows only what its Kernels need:

- It can't read the page, its cookies, `localStorage`, IndexedDB or the reader's notes.
- Its Content-Security-Policy blocks all network access except the runtime's origin and what you granted.
- The page talks to it over a `MessageChannel`, and accepts that channel only from its own iframe.

The page and frame don't need cross-origin isolation (COOP/COEP headers), so books keep their third-party images and embeds. [ADR 0001](./adr/0001-browser-sandbox-by-default.md) explains the browser quirks this works around.

**If your site sends a Content-Security-Policy**, the frame inherits it (all `srcdoc` documents do), and the frame's own policy can only narrow it. The Sandbox then needs your policy to allow an inline script, `blob:` workers, `'unsafe-eval'`, `'wasm-unsafe-eval'` and the Pyodide origin; otherwise Run reports that the Sandbox didn't start. Sites without a policy are unaffected.

## Self-hosting Pyodide

By default readers' browsers download Pyodide from `cdn.jsdelivr.net` the first time they run Python. To serve it yourself, copy the files of the `pyodide` npm package at the version zreader pins (`PYODIDE_VERSION` from `zreader/sandbox/browser`) to a folder, serve them with `Access-Control-Allow-Origin: *` (the frame has an opaque origin, so even your own origin counts as cross-origin), and point the Sandbox at it:

```tsx
<ScratchpadSandbox pyodideIndexURL="https://static.example.com/pyodide/" />
```

The frame's policy then allows that origin instead of jsDelivr. Pyodide isn't an npm dependency of zreader; it's only ever fetched at run time.

## Checking it in real browsers

The unit tests use simulated browser APIs. A script runs the real Sandbox, built from `dist`, in a page:

```sh
npm run build
node scripts/sandbox-check/run.mjs            # then open http://localhost:8766 in each browser
npx -p playwright node scripts/sandbox-check/run.mjs --auto   # Chromium, Firefox and WebKit
```

It checks variables between runs, the last expression, `await`, Stop and the run timeout, numpy and matplotlib, blocked network and storage, and granted permissions. `--auto` needs Playwright's browsers (`npx playwright install chromium firefox webkit`). Run it in real Safari and on iOS by hand before a release.

## API

See [API reference → `zreader/sandbox/browser`](./api-reference.md#zreadersandboxbrowser). To run RunnableCode somewhere else, implement `SandboxClient` from `zreader` and pass a `SandboxLoader` (`{ languages, load(settings) }`) to `<ReaderProvider sandbox>`.
