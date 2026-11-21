import { fileURLToPath } from "node:url";
import { withReader } from "zreader/next";

// Validates reader.config.ts, traces content/ into the build, keeps DOMPurify and
// MathJax external, and adds content.images.allowRemote hosts to images.remotePatterns.
export default withReader({
  reactStrictMode: true,
  // This example lives inside the zreader repo; pin the root to this folder.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
});
