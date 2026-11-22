/**
 * Code that runs inside the Sandbox frame, not on the reader's page. Each
 * function here is self-contained (no imports, no outer variables): it is
 * turned into source with `Function.prototype.toString` and started from a
 * blob URL in an opaque-origin iframe. See ADR 0001 for why each step is done
 * the way it is.
 */

/** Messages from the page to the frame. */
export type ToFrame =
  | { type: "run"; key: string; language: string; runId: number; code: string }
  | { type: "restart"; key: string }
  | { type: "dispose" };

/**
 * Messages from the frame to the page: run events carry `runId`. Besides the
 * RunEvents, a Kernel sends `{ type: "started" }` when the code itself starts,
 * after the runtime and packages have loaded: the run timeout counts from there.
 */
export type FromFrame =
  | { type: "event"; runId: number; event: Record<string, unknown> & { type: string } }
  | { type: "crashed"; key: string; message: string };

export interface FrameConfig {
  csp: string;
  /** Kernel worker source per language. */
  kernels: Record<string, string>;
}

/** Runs in the sandboxed iframe: applies the CSP, starts one worker per Kernel and relays messages. */
export function frameMain(config: FrameConfig) {
  // 'self' means nothing in an opaque origin, so the policy is added from script, before any Kernel starts.
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = config.csp;
  document.head.append(meta);

  const channel = new MessageChannel();
  const port = channel.port1;
  const kernels = new Map<string, { worker: Worker; ready: Promise<void> }>();

  const start = (key: string, language: string) => {
    const source = config.kernels[language];
    if (!source) throw new Error(`No Kernel for ${language}`);
    // Chromium refuses module workers from blob: URLs in opaque origins, so a classic worker import()s the module.
    const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const loaderUrl = URL.createObjectURL(
      new Blob([`import(${JSON.stringify(moduleUrl)}).catch((e) => postMessage({ type: "boot-error", message: String(e && e.message || e) }));`], { type: "text/javascript" }),
    );
    const worker = new Worker(loaderUrl);
    const entry = {
      worker,
      ready: new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; message?: string; runId?: number };
          if (m.type === "ready") {
            // Safari fails if the URLs are revoked right after new Worker().
            URL.revokeObjectURL(moduleUrl);
            URL.revokeObjectURL(loaderUrl);
            worker.onmessage = (ev: MessageEvent) => {
              const d = ev.data as { runId: number; event: Record<string, unknown> & { type: string } };
              port.postMessage({ type: "event", runId: d.runId, event: d.event });
            };
            resolve();
          } else if (m.type === "boot-error") reject(new Error(m.message));
        };
      }),
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.();
      if (kernels.get(key) !== entry) return;
      kernels.delete(key);
      worker.terminate();
      port.postMessage({ type: "crashed", key, message: e.message || "The Kernel stopped" });
    };
    kernels.set(key, entry);
    return entry;
  };

  const stop = (key: string) => {
    const k = kernels.get(key);
    if (k) {
      k.worker.terminate();
      kernels.delete(key);
    }
  };

  port.onmessage = async (e: MessageEvent) => {
    const m = e.data as { type: string; key: string; language: string; runId: number; code: string };
    if (m.type === "run") {
      try {
        const k = kernels.get(m.key) ?? start(m.key, m.language);
        await k.ready;
        if (kernels.get(m.key) !== k) return; // restarted while starting
        k.worker.postMessage({ type: "run", runId: m.runId, code: m.code });
      } catch (err) {
        stop(m.key);
        port.postMessage({ type: "crashed", key: m.key, message: String((err as Error)?.message ?? err) });
      }
    } else if (m.type === "restart") stop(m.key);
    else if (m.type === "dispose") for (const key of [...kernels.keys()]) stop(key);
  };

  parent.postMessage({ type: "zr-sandbox-ready" }, "*", [channel.port2]);
}

/** The JavaScript Kernel worker. Code arrives already rewritten (see rewrite.ts). */
/**
 * Runs in every Kernel before user code: `fetch` to an origin the site hasn't
 * granted fails with a clear message (the CSP is what actually blocks it), and
 * any failed fetch rethrows a fresh error, because WebKit's CSP rejection can
 * hang a Python run. `allowed` holds origins, `https://*.host` patterns, or `true`.
 */
export function installFetchGuard(allowed: string[] | true) {
  const permitted = (url: string) => {
    if (allowed === true) return true;
    let u: URL;
    try {
      u = new URL(url, self.location.href);
    } catch {
      return false;
    }
    return allowed.some((a) => {
      const m = /^(https?:)\/\/(\*\.)?([^/:]+)(:\d+)?\/?$/.exec(a);
      if (!m) return false;
      if (u.protocol !== m[1] || (m[4] ?? "") !== (u.port ? `:${u.port}` : "")) return false;
      return m[2] ? u.hostname.endsWith(`.${m[3]}`) : u.hostname === m[3];
    });
  };
  const rawFetch = self.fetch.bind(self);
  self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!permitted(url)) {
      let origin = url;
      try {
        origin = new URL(url, self.location.href).origin;
      } catch {
        /* keep the raw URL */
      }
      return Promise.reject(
        new TypeError(
          `Blocked by this site's permissions: code here can't reach ${origin}. Site owners grant network access in reader.config.ts (reader.sandbox.permissions.scratchpad.dangerousPermissions.network).`,
        ),
      );
    }
    return rawFetch(input, init).catch((e: unknown) => {
      throw new TypeError(`fetch failed: ${String((e as Error)?.message ?? e)}`);
    });
  };
}


export function javascriptKernel(config: { network: string[] | true }) {
  let runId = 0;
  const post = (event: Record<string, unknown>) => postMessage({ runId, event });
  const format = (v: unknown, top: boolean): string => {
    if (typeof v === "string") return top ? v : JSON.stringify(v);
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "function") return `[Function ${v.name || "(anonymous)"}]`;
    if (typeof v === "symbol" || v === undefined || v === null || typeof v !== "object") return String(v);
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (v instanceof Map) return `Map(${v.size}) ${format(Object.fromEntries(v), false)}`;
    if (v instanceof Set) return `Set(${v.size}) ${format([...v], false)}`;
    try {
      const seen = new WeakSet();
      return JSON.stringify(v, (_k, x) => {
        if (typeof x === "bigint") return `${x}n`;
        if (typeof x === "function") return `[Function ${x.name || "(anonymous)"}]`;
        if (typeof x === "object" && x !== null) {
          if (seen.has(x)) return "[Circular]";
          seen.add(x);
        }
        return x;
      });
    } catch {
      return String(v);
    }
  };
  for (const level of ["log", "info", "debug", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) =>
      post({ type: level === "warn" || level === "error" ? "stderr" : "stdout", text: args.map((a) => format(a, true)).join(" ") + "\n" });
  }
  installFetchGuard(config.network);
  // display(x): show an image under the code. Takes an OffscreenCanvas, an image Blob or an image data URL.
  const toBase64 = (buf: ArrayBuffer) => {
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  (self as unknown as { display: (x: unknown) => Promise<void> }).display = async (x: unknown) => {
    let blob: Blob | null = null;
    if (typeof OffscreenCanvas !== "undefined" && x instanceof OffscreenCanvas) blob = await x.convertToBlob({ type: "image/png" });
    else if (x instanceof Blob) blob = x;
    else if (typeof x === "string") {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(x.trim());
      if (m) return void post({ type: "display", mime: m[1]!.toLowerCase(), data: m[2]!.replace(/\s+/g, "") });
    }
    if (!blob || !blob.type.startsWith("image/")) throw new TypeError("display() takes an OffscreenCanvas, an image Blob or an image data URL");
    post({ type: "display", mime: blob.type, data: toBase64(await blob.arrayBuffer()) });
  };
  const AsyncFunction = (async () => {}).constructor as new (body: string) => () => Promise<unknown>;
  self.onmessage = async (e: MessageEvent) => {
    const m = e.data as { type: string; runId: number; code: string };
    if (m.type !== "run") return;
    runId = m.runId;
    const t0 = performance.now();
    post({ type: "started" });
    try {
      const value = await new AsyncFunction(m.code)();
      if (value !== undefined) post({ type: "result", text: format(value, false) });
      post({ type: "exit", ok: true, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      const x = err as Error;
      post({ type: "error", name: x?.name ?? "Error", message: String(x?.message ?? err) });
      post({ type: "exit", ok: false, ms: Math.round(performance.now() - t0) });
    }
  };
  postMessage({ type: "ready" });
}

/** The Python Kernel worker: Pyodide, loaded from `indexURL` on the first run. */
export function pythonKernel(config: { indexURL: string; network: string[] | true; packages: string[] }) {
  let runId = 0;
  const post = (event: Record<string, unknown>) => postMessage({ runId, event });
  // Pyodide loads its own files with fetch, and micropip needs PyPI when packages are granted.
  const runtime = [new URL(config.indexURL).origin, ...(config.packages.length ? ["https://pypi.org", "https://files.pythonhosted.org"] : [])];
  installFetchGuard(config.network === true ? true : [...runtime, ...config.network]);
  type Py = {
    setStdout(o: { batched: (s: string) => void }): void;
    setStderr(o: { batched: (s: string) => void }): void;
    loadPackagesFromImports(code: string, o: { messageCallback: (m: string) => void; errorCallback: (m: string) => void }): Promise<unknown>;
    runPythonAsync(code: string): Promise<unknown>;
    loadPackage(name: string, o: { messageCallback: (m: string) => void }): Promise<unknown>;
    toPy(v: unknown): unknown;
    globals: { get(name: string): (v: unknown) => unknown };
  };
  let pyodide: Promise<Py> | null = null;
  let micropipGuarded = false;
  // Open matplotlib figures as base64 PNGs, closed afterwards (like plt.show() in a notebook).
  const FIGURES = [
    "def _zr_figures():",
    "    import sys",
    "    plt = sys.modules.get('matplotlib.pyplot')",
    "    if plt is None:",
    "        return []",
    "    import io, base64",
    "    out = []",
    "    for n in plt.get_fignums():",
    "        buf = io.BytesIO()",
    "        plt.figure(n).savefig(buf, format='png', bbox_inches='tight')",
    "        out.append(base64.b64encode(buf.getvalue()).decode())",
    "    plt.close('all')",
    "    return out",
    "_zr_figures()",
  ].join("\n");
  // micropip may only install the packages the site granted, checked by name (ADR 0005).
  const MICROPIP_GUARD = [
    "def _zr_guard():",
    "    import re, micropip",
    "    norm = lambda n: re.sub(r'[-_.]+', '-', n).lower()",
    "    allowed = {norm(p) for p in _zr_allowed}",
    "    original = micropip.install",
    "    async def install(requirements, *args, **kwargs):",
    "        for r in ([requirements] if isinstance(requirements, str) else list(requirements)):",
    "            name = norm(re.split(r'[<>=!~\\[;@ ]', r.strip(), maxsplit=1)[0])",
    "            if name not in allowed:",
    "                raise PermissionError(f\"Blocked by this site's permissions: installing '{name}' isn't allowed. Site owners grant packages in reader.config.ts (reader.sandbox.permissions.scratchpad.dangerousPermissions.packages).\")",
    "        return await original(requirements, *args, **kwargs)",
    "    micropip.install = install",
    "_zr_guard()",
    "del _zr_guard, _zr_allowed",
  ].join("\n");
  const load = () => {
    if (!pyodide) {
      post({ type: "status", text: "Downloading the Python runtime (about 10 MB)…" });
      pyodide = (import(/* webpackIgnore: true */ /* @vite-ignore */ `${config.indexURL}pyodide.mjs`) as Promise<{ loadPyodide(o: { indexURL: string }): Promise<Py> }>)
        .then((m) => m.loadPyodide({ indexURL: config.indexURL }))
        .then(async (py) => {
          // Plots render off-screen (there's no DOM in a worker); figures are sent as images after each run.
          await py.runPythonAsync("import os\nos.environ['MPLBACKEND'] = 'agg'");
          return py;
        });
      pyodide.catch(() => (pyodide = null));
    }
    return pyodide;
  };
  self.onmessage = async (e: MessageEvent) => {
    const m = e.data as { type: string; runId: number; code: string };
    if (m.type !== "run") return;
    runId = m.runId;
    const t0 = performance.now();
    try {
      const py = await load();
      py.setStdout({ batched: (s) => post({ type: "stdout", text: `${s}\n` }) });
      py.setStderr({ batched: (s) => post({ type: "stderr", text: `${s}\n` }) });
      // Packages Pyodide ships (numpy, pandas, …) come from indexURL; nothing else is fetched.
      await py.loadPackagesFromImports(m.code, { messageCallback: () => {}, errorCallback: (s) => post({ type: "stderr", text: `${s}\n` }) });
      if (/\bmicropip\b/.test(m.code) && !micropipGuarded) {
        await py.loadPackage("micropip", { messageCallback: () => {} });
        (py as unknown as { globals: { set(k: string, v: unknown): void } }).globals.set("_zr_allowed", py.toPy(config.packages));
        await py.runPythonAsync(MICROPIP_GUARD);
        micropipGuarded = true;
      }
      post({ type: "started" });
      let value: unknown;
      try {
        value = await py.runPythonAsync(m.code);
      } finally {
        const figures = (await py.runPythonAsync(FIGURES)) as { toJs?(): unknown } | string[] | undefined;
        const list = ((figures as { toJs?(): unknown })?.toJs?.() ?? figures ?? []) as string[];
        for (const data of list) post({ type: "display", mime: "image/png", data });
        (figures as { destroy?(): void } | undefined)?.destroy?.();
      }
      if (value !== undefined) {
        const repr = py.globals.get("repr");
        post({ type: "result", text: String(repr(value)) });
        (repr as unknown as { destroy?(): void }).destroy?.();
        (value as { destroy?(): void } | null)?.destroy?.();
      }
      post({ type: "exit", ok: true, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      const x = err as Error & { type?: string };
      const text = String(x?.message ?? err).trimEnd();
      // A PythonError's message is the whole traceback; its last line names the error.
      const last = text.split("\n").at(-1) ?? text;
      const colon = last.indexOf(": ");
      post({
        type: "error",
        name: x?.type ?? (colon > 0 ? last.slice(0, colon) : (x?.name ?? "Error")),
        message: colon > 0 ? last.slice(colon + 2) : last,
        traceback: text.includes("Traceback") ? text.replace(/^[\s\S]*?(?=Traceback)/, "") : undefined,
      });
      post({ type: "exit", ok: false, ms: Math.round(performance.now() - t0) });
    }
  };
  postMessage({ type: "ready" });
}

/** Source for `fn(...args)`, to start from a blob URL. */
export function sourceOf(fn: (...args: never[]) => unknown, ...args: unknown[]): string {
  return `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(", ")});`;
}

/** Source for a Kernel worker: the fetch guard, then the Kernel. */
export function kernelSource(fn: (...args: never[]) => unknown, ...args: unknown[]): string {
  return `${installFetchGuard.toString()}\n${sourceOf(fn, ...args)}`;
}
