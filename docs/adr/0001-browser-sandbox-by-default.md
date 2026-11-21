---
status: accepted
---

# RunnableCode runs in the browser by default; a server Sandbox is opt-in

zreader works with no backend, so RunnableCode runs in the reader's browser by default: Python in Pyodide and JS/TS in a worker, both inside an opaque-origin sandboxed iframe that cannot reach zreader's storage. A site can configure a server Sandbox in `reader.config.ts`. Where it is enabled (per pad scope, per shelf), it takes over for the languages it supports.

## Considered Options

- **StackBlitz WebContainers.** Rejected for four reasons: commercial production use needs a paid license with no published price, which every commercial zreader site would inherit; the host page must be cross-origin isolated (COOP/COEP), which breaks the third-party embeds books use; it is fully supported only on desktop Chromium; and it has no Python.
- **Server only.** Rejected as the default, because it would make the feature unusable on static and Vite sites and turn every site into a public code-execution endpoint. It is kept as the opt-in override.

## Consequences

A prototype (`prototype/browser-kernel`) confirmed the approach in Chromium, Firefox and WebKit, and showed constraints a future reader would otherwise "fix":

- The worker is a one-line classic worker that `import()`s the Kernel module from a blob URL, because Chromium refuses module workers from blob URLs in opaque-origin iframes.
- Blob URLs are revoked only after the worker reports ready, because Safari fails if they are revoked right after `new Worker()`.
- The CSP is added from the iframe's script, not a `<meta>` in `srcdoc`, because `'self'` means nothing in an opaque origin.
- The Kernel wraps `fetch` to rethrow a fresh error, because WebKit's CSP rejection cannot be turned into a Python exception and the run hangs.
