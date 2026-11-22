// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RunEvent, RunRequest } from "../src/core/index";
import { KernelHost, isFrameHandshake, type KernelHostOptions } from "../src/sandbox/browser/host";
import { DEFAULT_PYODIDE_INDEX_URL, browserSandbox, frameConfig, kernelCsp } from "../src/sandbox/browser/index";
import type { FromFrame, ToFrame } from "../src/sandbox/browser/kernels";

/**
 * A fake frame on a real MessageChannel. Each Kernel "runs" code by looking it
 * up in `script`: `hang` never exits, `crash` kills the worker, anything else
 * echoes. Kernels keep a counter of runs, so restarts are visible.
 */
function fakeFrame() {
  const sent: ToFrame[] = [];
  const kernels = new Map<string, number>();
  let opened = 0;
  let closed = 0;
  const open = async () => {
    opened++;
    const ch = new MessageChannel();
    const post = (m: FromFrame) => ch.port2.postMessage(m);
    ch.port2.onmessage = (e: MessageEvent) => {
      const m = e.data as ToFrame;
      sent.push(m);
      if (m.type === "restart") kernels.delete(m.key);
      if (m.type !== "run") return;
      const n = (kernels.get(m.key) ?? 0) + 1;
      kernels.set(m.key, n);
      const finish = () => {
        post({ type: "event", runId: m.runId, event: { type: "stdout", text: `${m.code} #${n}\n` } });
        post({ type: "event", runId: m.runId, event: { type: "exit", ok: true, ms: 1 } });
      };
      // `slowload`: the runtime takes 50 ms to load before the code starts.
      if (m.code === "slowload") return void setTimeout(() => (post({ type: "event", runId: m.runId, event: { type: "started" } }), finish()), 50);
      post({ type: "event", runId: m.runId, event: { type: "started" } });
      if (m.code === "hang") return;
      if (m.code === "crash") return post({ type: "crashed", key: m.key, message: "out of memory" });
      finish();
    };
    return { port: ch.port1, close: () => void closed++ };
  };
  return { open, sent, stats: () => ({ opened, closed }) };
}

function host(frame: ReturnType<typeof fakeFrame>, opts: Partial<KernelHostOptions> = {}) {
  return new KernelHost({ languages: ["javascript", "python"], openFrame: () => frame.open(), prepare: async (_l, c) => c, runTimeoutMs: false, idleTimeoutMs: false, ...opts });
}

const req = (code: string, over: Partial<RunRequest> = {}): RunRequest => ({ kernel: "pad:global#t", runnableId: "r", language: "javascript", code, codeSource: "scratchpad", ...over });

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const texts = (events: RunEvent[]) => events.filter((e) => e.type !== "started").map((e) => ("text" in e ? `${e.type}:${e.text.trim()}` : "reason" in e ? `${e.type}:${e.reason}` : e.type));

describe("browser Sandbox: Kernel host", () => {
  it("opens the frame once, on the first run, and streams events until exit", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    expect(frame.stats().opened).toBe(0);
    expect(texts(await collect(h.run(req("a"))))).toEqual(["stdout:a #1", "exit"]);
    expect(texts(await collect(h.run(req("b"))))).toEqual(["stdout:b #2", "exit"]);
    expect(frame.stats().opened).toBe(1);
  });

  it("keeps one Kernel per pad and language, and runs them one at a time", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    const [a, b, c] = await Promise.all([collect(h.run(req("a"))), collect(h.run(req("b"))), collect(h.run(req("c", { language: "python" })))]);
    expect(texts(a)[0]).toBe("stdout:a #1");
    expect(texts(b)[0]).toBe("stdout:b #2");
    expect(texts(c)[0]).toBe("stdout:c #1");
    const runs = frame.sent.filter((m): m is Extract<ToFrame, { type: "run" }> => m.type === "run");
    expect(new Set(runs.map((r) => r.key))).toEqual(new Set(["pad:global#t|javascript", "pad:global#t|python"]));
  });

  it("Stop restarts the Kernel: the run ends with `restarted` and the next run starts fresh", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    await collect(h.run(req("a")));
    const pending = collect(h.run(req("hang")));
    await new Promise((r) => setTimeout(r, 10));
    await h.restart("pad:global#t", "javascript");
    expect(texts(await pending)).toEqual(["restarted:stopped"]);
    expect(texts(await collect(h.run(req("b"))))[0]).toBe("stdout:b #1");
  });

  it("counts the run timeout from when the code starts, not while the runtime loads", async () => {
    const frame = fakeFrame();
    const h = host(frame, { runTimeoutMs: 20 });
    expect(texts(await collect(h.run(req("slowload"))))).toEqual(["stdout:slowload #1", "exit"]);
  });

  it("stops a run that takes too long", async () => {
    const frame = fakeFrame();
    const h = host(frame, { runTimeoutMs: 20 });
    expect(texts(await collect(h.run(req("hang"))))).toEqual(["restarted:timeout"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(frame.sent.some((m) => m.type === "restart")).toBe(true);
  });

  it("shuts down an idle Kernel and says so on the next run", async () => {
    const frame = fakeFrame();
    const h = host(frame, { idleTimeoutMs: 20 });
    await collect(h.run(req("a")));
    await new Promise((r) => setTimeout(r, 40));
    expect(texts(await collect(h.run(req("b"))))).toEqual(["restarted:idle", "stdout:b #1", "exit"]);
  });

  it("reports a crashed Kernel as an error and a restart", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    expect(texts(await collect(h.run(req("crash"))))).toEqual(["error", "restarted:crashed"]);
  });

  it("reports code that can't be prepared without starting a Kernel", async () => {
    const frame = fakeFrame();
    const h = host(frame, { prepare: async () => { throw new SyntaxError("Unexpected token (line 1, column 5)"); } });
    const events = await collect(h.run(req("let = ;")));
    expect(events[0]).toMatchObject({ type: "error", name: "SyntaxError" });
    expect(frame.stats().opened).toBe(0);
  });

  it("dispose ends running code and closes the frame", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    const pending = collect(h.run(req("hang")));
    await new Promise((r) => setTimeout(r, 10));
    h.dispose();
    expect(texts(await pending)).toEqual(["restarted:stopped"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(frame.stats().closed).toBe(1);
    expect(frame.sent.at(-1)).toEqual({ type: "dispose" });
  });

  it("gives Python and JavaScript separate frames", async () => {
    const frame = fakeFrame();
    const groups: string[] = [];
    const h = host(frame, { openFrame: (g) => (groups.push(g), frame.open()) });
    await collect(h.run(req("a")));
    await collect(h.run(req("b", { language: "python" })));
    await collect(h.run(req("c")));
    expect(groups).toEqual(["javascript", "python"]);
  });

  it("cancels a run that is still waiting for its Kernel, without running it", async () => {
    const frame = fakeFrame();
    const h = host(frame);
    const first = collect(h.run(req("hang")));
    const abort = new AbortController();
    const queued = collect(h.run(req("never"), { signal: abort.signal }));
    await new Promise((r) => setTimeout(r, 10));
    abort.abort();
    expect(await queued).toEqual([]);
    await h.restart("pad:global#t", "javascript");
    await first;
    await new Promise((r) => setTimeout(r, 10));
    expect(frame.sent.some((m) => m.type === "run" && m.code === "never")).toBe(false);
  });

  it("doesn't start code that was stopped while the frame was opening", async () => {
    const frame = fakeFrame();
    const h = host(frame, { openFrame: async () => (await new Promise((r) => setTimeout(r, 30)), frame.open()), runTimeoutMs: 20 });
    const pending = collect(h.run(req("hang")));
    await new Promise((r) => setTimeout(r, 5));
    await h.restart("pad:global#t", "javascript");
    expect(texts(await pending)).toEqual(["restarted:stopped"]);
    await new Promise((r) => setTimeout(r, 60));
    expect(frame.sent.some((m) => m.type === "run")).toBe(false);
    // A later run isn't cut short by a leftover timer.
    expect(texts(await collect(h.run(req("ok"))))).toEqual(["stdout:ok #1", "exit"]);
  });

  it("only accepts the port from its own frame, with a null origin", () => {
    const frame = {} as Window;
    const port = new MessageChannel().port1;
    const ok = { source: frame, origin: "null", data: { type: "zr-sandbox-ready" }, ports: [port] };
    expect(isFrameHandshake(ok as never, frame)).toBe(true);
    expect(isFrameHandshake({ ...ok, source: {} as Window } as never, frame)).toBe(false);
    expect(isFrameHandshake({ ...ok, origin: "https://evil.example" } as never, frame)).toBe(false);
    expect(isFrameHandshake({ ...ok, ports: [] } as never, frame)).toBe(false);
    expect(isFrameHandshake({ ...ok, data: { type: "other" } } as never, frame)).toBe(false);
  });
});

describe("browser Sandbox: setup", () => {
  it("blocks all network access by default", () => {
    expect(kernelCsp()).toBe("default-src 'none'; script-src blob: 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'");
    expect(kernelCsp({ connect: ["https://cdn.example"] })).toContain("connect-src https://cdn.example");
  });

  it("lets Python reach only the origin Pyodide is loaded from", () => {
    expect(frameConfig({ languages: ["python"] }).csp).toContain(`connect-src ${new URL(DEFAULT_PYODIDE_INDEX_URL).origin}`);
    const self = frameConfig({ languages: ["python"], pyodideIndexURL: "https://static.example.org/pyodide" });
    expect(self.csp).toMatch(/connect-src https:\/\/static\.example\.org$/);
    expect(self.csp).not.toContain("jsdelivr");
    expect(self.kernels.python).toContain("https://static.example.org/pyodide/");
    expect(frameConfig({ languages: ["javascript"] }).csp).toContain("connect-src 'none'");
  });

  it("offers only the languages it can run", () => {
    expect(browserSandbox().languages).toContain("javascript");
    expect(browserSandbox({ languages: ["javascript"] }).languages).toEqual(["javascript"]);
  });
});

describe("browser Sandbox: Dangerous permissions", () => {
  it("builds the CSP from what the site granted", () => {
    const js = (p?: Parameters<typeof frameConfig>[0]["dangerousPermissions"]) => frameConfig({ languages: ["javascript"], dangerousPermissions: p }).csp;
    expect(js()).toContain("connect-src 'none'");
    expect(js({ network: ["https://api.example.com/"] })).toMatch(/connect-src https:\/\/api\.example\.com$/);
    expect(js({ network: ["https://api.example.com"] })).toContain("script-src blob: 'unsafe-eval' 'wasm-unsafe-eval' https://api.example.com;");
    expect(js({ network: true })).toMatch(/connect-src \*$/);
    // Packages are a Python permission: they add PyPI only when Python is offered.
    expect(js({ packages: ["rich"] })).toContain("connect-src 'none'");
    const py = frameConfig({ languages: ["python"], dangerousPermissions: { packages: ["rich"] } });
    expect(py.csp).toContain("https://pypi.org https://files.pythonhosted.org");
    expect(py.kernels.python).toContain('"packages":["rich"]');
    expect(frameConfig({ languages: ["python"] }).csp).not.toContain("pypi");
  });

  it("refuses fetches to origins the site didn't grant, with a message that says why", async () => {
    const { installFetchGuard } = await import("../src/sandbox/browser/kernels");
    const calls: string[] = [];
    const g = globalThis as unknown as { fetch: typeof fetch };
    const saved = g.fetch;
    try {
      const guard = (allowed: string[] | true) => {
        g.fetch = (async (u: string) => (calls.push(u), new Response("ok"))) as typeof fetch;
        installFetchGuard(allowed);
        return g.fetch;
      };
      const f = guard(["https://api.example.com", "https://*.cdn.example"]);
      await expect(f("https://api.example.com/v1")).resolves.toBeInstanceOf(Response);
      await expect(f("https://a.cdn.example/x.js")).resolves.toBeInstanceOf(Response);
      await expect(f("https://evil.example/")).rejects.toThrow(/Blocked by this site's permissions: code here can't reach https:\/\/evil\.example/);
      await expect(f("http://api.example.com/")).rejects.toThrow(/Blocked/);
      await expect(f("https://api.example.com:8443/")).rejects.toThrow(/Blocked/);
      expect(calls).toEqual(["https://api.example.com/v1", "https://a.cdn.example/x.js"]);
      await expect(guard(true)("https://anything.example/")).resolves.toBeInstanceOf(Response);
    } finally {
      g.fetch = saved;
    }
  });
});
