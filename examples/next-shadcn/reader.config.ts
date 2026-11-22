import { defineConfig } from "zreader/config";
import { llmsTxt } from "zreader/plugins/agent";

export default defineConfig({
  content: {
    // TeX → MathML at build time (`npm i katex`). Also "temml" or "mathjax".
    math: "katex",
    images: {
      // Remote images from these hosts are optimized by next/image; others are dropped.
      allowRemote: ["upload.wikimedia.org"],
    },
  },
  reader: {
    // "Save for offline" on book pages, served by app/zreader-sw.js/route.ts.
    offline: { enabled: true },
    // RunnableCode (turned on by <ScratchpadSandbox /> in app/books/layout.tsx). These only limit it:
    // no RunnableCode in the "All books" pad, and Kernels shut down after 10 idle minutes.
    sandbox: {
      scopes: { global: false },
      kernel: { idleTimeoutMs: 10 * 60_000 },
    },
  },
  agent: { plugins: [llmsTxt({ full: true })] },
});
