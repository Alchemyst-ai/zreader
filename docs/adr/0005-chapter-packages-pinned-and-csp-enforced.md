---
status: accepted
---

# Chapter packages are pinned to exact wheel URLs and enforced by CSP

A package allowlist checked by name inside `micropip` does not stop author code: once the Kernel's CSP allows PyPI, code can `fetch` any wheel directly. For `codeSource: chapter`, allowed packages are therefore pinned (`pandas==2.2.3`). At build time the server resolves them and their dependencies to exact wheel URLs, and the Kernel's CSP allows only those URLs. Packages Pyodide ships are loaded from its `indexURL` and need no PyPI access.

For `codeSource: scratchpad`, the code is the reader's own, so checking package names is enough and nothing is pinned. `packages` applies to Python only; JS module imports are granted through `network`.
