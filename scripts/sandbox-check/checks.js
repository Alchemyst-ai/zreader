// The checks, bundled with the built zreader/sandbox/browser by run.mjs.
import { browserSandbox } from "../../dist/sandbox/browser/index.js";

import * as sucrase from "sucrase";

const sandbox = browserSandbox({ runTimeoutMs: 30_000, idleTimeoutMs: false, typescript: async () => sucrase });
// A Sandbox with a short run timeout, for the timeout check.
const quick = browserSandbox({ runTimeoutMs: 2000, idleTimeoutMs: false }).load();
const clientPromise = sandbox.load();
// A second Sandbox with Dangerous permissions granted, as reader.sandbox.permissions would.
const granted = browserSandbox({ runTimeoutMs: 60_000, idleTimeoutMs: false }).load({
  permissions: { scratchpad: { dangerousPermissions: { network: ["https://cdn.jsdelivr.net"], packages: ["tabulate"] } } },
});
async function runGranted(language, code) {
  const client = await granted;
  const events = [];
  for await (const e of client.run({ kernel: "granted", runnableId: `g${++n}`, language, code, codeSource: "scratchpad" })) events.push(e);
  return events;
}
let n = 0;

async function run(language, code, kernel = "check") {
  const client = await clientPromise;
  const events = [];
  for await (const e of client.run({ kernel, runnableId: `r${++n}`, language, code, codeSource: "scratchpad" })) events.push(e);
  return events;
}
const result = (ev) => ev.find((e) => e.type === "result")?.text;
const error = (ev) => ev.find((e) => e.type === "error");
const stdout = (ev) => ev.filter((e) => e.type === "stdout").map((e) => e.text).join("");
const has = (lang) => sandbox.languages.includes(lang);

const CHECKS = [
  ["JavaScript: keeps variables between runs", async () => {
    await run("javascript", "const n = 20");
    const r = result(await run("javascript", "n * 2 + 2"));
    return [r === "42", r];
  }],
  ["JavaScript: a const can be declared again", async () => {
    await run("javascript", "const m = 1");
    const r = result(await run("javascript", "const m = 2\nm"));
    return [r === "2", r];
  }],
  ["JavaScript: top-level await and console", async () => {
    const ev = await run("javascript", "console.log('hi')\nawait new Promise((r) => setTimeout(() => r(7), 10))");
    return [stdout(ev) === "hi\n" && result(ev) === "7", ev.map((e) => e.type).join(",")];
  }],
  ["JavaScript: functions are hoisted and kept", async () => {
    await run("javascript", "twice(1)\nfunction twice(x) { return x * 2 }");
    const r = result(await run("javascript", "twice(21)"));
    return [r === "42", r];
  }],
  ["JavaScript: the network is blocked", async () => {
    const ev = await run("javascript", "await fetch('https://example.com/', { mode: 'no-cors' })\n'reached'");
    return [!result(ev) && !!error(ev), error(ev)?.message ?? "reached example.com"];
  }],
  ["JavaScript: the reader's storage is out of reach", async () => {
    const ev = await run("javascript", "let out = []\ntry { localStorage.length; out.push('localStorage') } catch {}\ntry { indexedDB.open('x'); out.push('indexedDB') } catch {}\ntry { parent.document; out.push('page') } catch {}\nout.join(',') || 'none'");
    const r = result(ev) ?? error(ev)?.message;
    return [r === '"none"', r];
  }],
  ["JavaScript: Stop restarts the Kernel and clears variables", async () => {
    await run("javascript", "const kept = 1");
    const client = await clientPromise;
    const pending = run("javascript", "while (true) {}");
    await new Promise((r) => setTimeout(r, 300));
    await client.restart("check", "javascript");
    const ev = await pending;
    const after = await run("javascript", "typeof kept");
    return [ev.at(-1)?.type === "restarted" && result(after) === '"undefined"', `${ev.map((e) => e.type).join(",")} then ${result(after)}`];
  }],
  ["JavaScript: a run that takes too long is stopped", async () => {
    const client = await quick;
    const ev = [];
    for await (const e of client.run({ kernel: "timeout", runnableId: "t", language: "javascript", code: "while (true) {}", codeSource: "scratchpad" })) ev.push(e);
    const last = ev.at(-1);
    return [last?.type === "restarted" && last.reason === "timeout", JSON.stringify(last)];
  }],
  ["Python: shows prints and the last expression", async () => {
    if (!has("python")) return [true, "skipped: no Python in this build"];
    const ev = await run("python", "x = 41\nprint('x is', x)\nx + 1");
    return [result(ev) === "42" && stdout(ev) === "x is 41\n", result(ev) ?? error(ev)?.message ?? ev.map((e) => e.type + (e.reason ? `:${e.reason}` : "")).join(",")];
  }],
  ["Python: keeps variables between runs", async () => {
    if (!has("python")) return [true, "skipped"];
    const r = result(await run("python", "x * 2"));
    return [r === "82", r];
  }],
  ["Python: imports a bundled package (numpy)", async () => {
    if (!has("python")) return [true, "skipped"];
    const ev = await run("python", "import numpy as np\nint(np.arange(5).sum())");
    return [result(ev) === "10", result(ev) ?? error(ev)?.message?.split("\n").at(-1)];
  }],
  ["Python: the network is blocked", async () => {
    if (!has("python")) return [true, "skipped"];
    const ev = await run("python", "from js import fetch\nawait fetch('https://example.com/', mode='no-cors')\n'reached'");
    return [!result(ev) && !!error(ev), error(ev)?.message?.split("\n").at(-1) ?? "reached"];
  }],
  ["Python: Stop restarts the Kernel and clears variables", async () => {
    if (!has("python")) return [true, "skipped"];
    const client = await clientPromise;
    const pending = run("python", "while True: pass");
    await new Promise((r) => setTimeout(r, 500));
    await client.restart("check", "python");
    const ev = await pending;
    const after = error(await run("python", "x"));
    return [ev.at(-1)?.type === "restarted" && after?.name === "NameError", after ? `${after.name}: ${after.message}` : "x still defined"];
  }],
  ["Python: a matplotlib figure comes back as an image", async () => {
    if (!has("python")) return [true, "skipped"];
    const ev = await run("python", "import matplotlib.pyplot as plt\nplt.plot([1, 3, 2])\nplt.title('x')", "plots");
    const d = ev.filter((e) => e.type === "display");
    return [d.length === 1 && d[0].mime === "image/png" && d[0].data.startsWith("iVBOR"), d.length ? `${d.length} image(s), ${d[0].data.length} chars` : (error(ev)?.message?.split("\n").at(-1) ?? ev.map((e) => e.type + (e.reason ? `:${e.reason}` : "")).join(","))];
  }],
  ["JavaScript: display() shows a canvas as an image", async () => {
    const ev = await run("javascript", "const c = new OffscreenCanvas(4, 4)\nc.getContext('2d').fillRect(0, 0, 4, 4)\nawait display(c)");
    const d = ev.find((e) => e.type === "display");
    return [d?.mime === "image/png", d ? `${d.mime}, ${d.data.length} chars` : error(ev)?.message];
  }],
  ["Permissions: none granted, fetch says the site blocked it", async () => {
    const ev = await run("javascript", "await fetch('https://cdn.jsdelivr.net/npm/acorn/package.json')");
    return [/Blocked by this site's permissions/.test(error(ev)?.message ?? ""), error(ev)?.message];
  }],
  ["JavaScript: can't import from the Python runtime's origin", async () => {
    const ev = await run("javascript", "await import('https://cdn.jsdelivr.net/npm/acorn@8/+esm')\n'imported'");
    return [!result(ev) && !!error(ev), error(ev)?.message ?? "imported"];
  }],
  ["Permissions: none granted, micropip.install is refused", async () => {
    if (!has("python")) return [true, "skipped"];
    const ev = await run("python", "import micropip\nawait micropip.install('tabulate')");
    const e = error(ev);
    return [e?.name === "PermissionError", e ? `${e.name}: ${e.message}` : "installed"];
  }],
  ["Permissions: a granted origin is reachable, others are not", async () => {
    const ok = await runGranted("javascript", "(await fetch('https://cdn.jsdelivr.net/npm/acorn/package.json')).status");
    const no = await runGranted("javascript", "await fetch('https://example.com/')");
    return [result(ok) === "200" && /Blocked/.test(error(no)?.message ?? ""), `${result(ok)} / ${error(no)?.message?.slice(0, 60)}`];
  }],
  ["Permissions: a granted package installs, another is refused", async () => {
    if (!has("python")) return [true, "skipped"];
    const ok = await runGranted("python", "import micropip\nawait micropip.install('tabulate')\nimport tabulate\ntabulate.tabulate([[1, 2]])");
    const no = await runGranted("python", "import micropip\nawait micropip.install('requests')");
    return [!!result(ok) && error(no)?.name === "PermissionError", `${result(ok) ?? error(ok)?.message?.split("\n").at(-1)} / ${error(no)?.name}`];
  }],
  ["TypeScript: types are stripped and variables kept", async () => {
    if (!has("typescript")) return [true, "skipped: no TypeScript in this build"];
    await run("typescript", "interface P { x: number }\nconst p: P = { x: 40 }");
    const r = result(await run("typescript", "(p.x as number) + 2"));
    return [r === "42", r];
  }],
];

window.runChecks = async () => {
  const out = document.getElementById("out");
  out.textContent = "";
  const results = [];
  for (const [name, fn] of CHECKS) {
    const tr = out.insertRow();
    tr.innerHTML = "<td></td><td>running…</td><td></td>";
    tr.cells[0].textContent = name;
    let pass = false;
    let detail = "";
    try {
      [pass, detail] = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 90 s")), 90_000))]);
    } catch (err) {
      detail = String(err?.message ?? err);
    }
    tr.cells[1].className = pass ? "pass" : "fail";
    tr.cells[1].textContent = pass ? "pass" : "fail";
    tr.cells[2].textContent = String(detail ?? "");
    results.push({ name, pass, detail: String(detail ?? "") });
  }
  return results;
};
document.getElementById("run").onclick = () => window.runChecks();
document.getElementById("ua").textContent = navigator.userAgent;
