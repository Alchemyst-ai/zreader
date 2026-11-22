/**
 * Real-browser checks for `zreader/sandbox/browser`, run against the built
 * package (`npm run build` first). Unit tests can't cover these: they need a
 * real iframe, worker, CSP and Pyodide.
 *
 *   node scripts/sandbox-check/run.mjs          # serve, then open the URL in each browser
 *   node scripts/sandbox-check/run.mjs --auto   # run Chromium, Firefox and WebKit with Playwright
 *
 * `--auto` needs Playwright and its browsers: `npx playwright install chromium firefox webkit`,
 * then `npx -p playwright node scripts/sandbox-check/run.mjs --auto`.
 */
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const auto = process.argv.includes("--auto");
const port = Number(process.env.PORT ?? 8766);

const bundle = await build({
  entryPoints: [join(here, "checks.js")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // The Sandbox imports React only for <ScratchpadSandbox />; the checks don't render it.
  alias: { react: join(here, "stubs.js"), "zreader/react": join(here, "stubs.js"), zreader: join(root, "dist/core/index.js") },
  nodePaths: [join(root, "node_modules")],
});
const js = bundle.outputFiles[0].text;
const html = await readFile(join(here, "index.html"), "utf8");

const server = createServer((req, res) => {
  if (req.url === "/checks.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(js);
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
}).listen(port);
const url = `http://localhost:${port}/`;

if (!auto) {
  console.log(`Sandbox checks: open ${url} in each browser and press "Run all checks". Ctrl+C to stop.`);
} else {
  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    console.error("--auto needs Playwright: npx -p playwright node scripts/sandbox-check/run.mjs --auto");
    process.exit(2);
  }
  let failed = 0;
  for (const name of ["chromium", "firefox", "webkit"]) {
    const browser = await playwright[name].launch();
    const page = await browser.newPage();
    await page.goto(url);
    const results = await page.evaluate(() => window.runChecks());
    console.log(`\n=== ${name} ${browser.version()} ===`);
    for (const r of results) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  | ${r.detail}`);
    }
    await browser.close();
  }
  server.close();
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}
