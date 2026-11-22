/**
 * The page side of the browser Sandbox: a `SandboxClient` that runs every
 * Kernel inside one hidden opaque-origin iframe (see kernels.ts). It owns the
 * run timeout, idle shutdown and the queue of runs per Kernel, so the frame
 * only starts, stops and relays.
 */
import type { RunEvent, RunRequest, SandboxClient, SandboxLanguage } from "zreader";
import type { FromFrame, ToFrame } from "./kernels";

export interface KernelHostOptions {
  languages: readonly SandboxLanguage[];
  /** Opens the frame and resolves with its port. Called on the first run. */
  openFrame(): Promise<{ port: MessagePort; close(): void }>;
  /** Turns a run's code into what the Kernel executes (rewriting JavaScript, stripping types). */
  prepare(language: SandboxLanguage, code: string): Promise<string>;
  /** A run longer than this restarts its Kernel. `0` or `false`: no limit. Counted from when the code starts, not while the runtime loads. */
  runTimeoutMs: number | false;
  /** How long a Kernel may take to load its runtime and packages before the run is stopped. Default 2 minutes. */
  loadTimeoutMs?: number;
  /** A Kernel with no run for this long is shut down. `0` or `false`: never. */
  idleTimeoutMs: number | false;
}

/** A queue of events that one consumer reads as an async iterable. */
class EventStream {
  private items: RunEvent[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  private resolveClosed!: () => void;
  /** Settles when the run ends, whether or not anyone is still reading. */
  readonly closed = new Promise<void>((r) => (this.resolveClosed = r));
  push(e: RunEvent) {
    if (this.done) return;
    this.items.push(e);
    this.wake?.();
  }
  end() {
    this.done = true;
    this.resolveClosed();
    this.wake?.();
  }
  async *read(signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const onAbort = () => this.wake?.();
    signal?.addEventListener("abort", onAbort);
    try {
      for (;;) {
        if (signal?.aborted) return;
        const next = this.items.shift();
        if (next) {
          yield next;
          continue;
        }
        if (this.done) return;
        await new Promise<void>((r) => (this.wake = r));
        this.wake = null;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

interface ActiveRun {
  runId: number;
  key: string;
  stream: EventStream;
  timer?: ReturnType<typeof setTimeout>;
}

interface KernelState {
  queue: Promise<void>;
  active: ActiveRun | null;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Shut down while idle: the next run says so. */
  idleRestarted: boolean;
}

export class KernelHost implements SandboxClient {
  readonly languages: readonly SandboxLanguage[];
  private frame: Promise<{ port: MessagePort; close(): void }> | null = null;
  private kernels = new Map<string, KernelState>();
  private runs = new Map<number, ActiveRun>();
  private seq = 0;
  private disposed = false;

  constructor(private readonly options: KernelHostOptions) {
    this.languages = options.languages;
  }

  private port(): Promise<MessagePort> {
    if (!this.frame) {
      this.frame = this.options.openFrame().then((f) => {
        f.port.onmessage = (e: MessageEvent) => this.receive(e.data as FromFrame);
        return f;
      });
      this.frame.catch(() => (this.frame = null));
    }
    return this.frame.then((f) => f.port);
  }

  private send(message: ToFrame) {
    void this.frame?.then((f) => f.port.postMessage(message), () => {});
  }

  private receive(m: FromFrame) {
    if (m.type === "event") {
      const run = this.runs.get(m.runId);
      if (!run) return;
      if (m.event.type === "started") {
        const limit = this.options.runTimeoutMs;
        clearTimeout(run.timer);
        if (limit) run.timer = setTimeout(() => this.restartKey(run.key, "timeout"), limit);
        return;
      }
      run.stream.push(m.event as RunEvent);
      if (m.event.type === "exit") this.finish(run);
    } else if (m.type === "crashed") {
      const state = this.kernels.get(m.key);
      const run = state?.active;
      if (run) {
        run.stream.push({ type: "error", name: "KernelError", message: m.message });
        run.stream.push({ type: "restarted", reason: "crashed" });
        this.finish(run);
      }
    }
  }

  private finish(run: ActiveRun) {
    clearTimeout(run.timer);
    this.runs.delete(run.runId);
    run.stream.end();
  }

  private state(key: string): KernelState {
    let s = this.kernels.get(key);
    if (!s) this.kernels.set(key, (s = { queue: Promise.resolve(), active: null, idleRestarted: false }));
    return s;
  }

  private scheduleIdle(key: string, state: KernelState) {
    clearTimeout(state.idleTimer);
    const ms = this.options.idleTimeoutMs;
    if (!ms) return;
    state.idleTimer = setTimeout(() => {
      if (state.active) return;
      this.send({ type: "restart", key });
      state.idleRestarted = true;
    }, ms);
  }

  /** Ends the Kernel; a run in it reports `restarted` with `reason`. */
  private restartKey(key: string, reason: "stopped" | "timeout") {
    const state = this.kernels.get(key);
    this.send({ type: "restart", key });
    if (!state) return;
    clearTimeout(state.idleTimer);
    state.idleRestarted = false;
    const run = state.active;
    if (run) {
      run.stream.push({ type: "restarted", reason });
      this.finish(run);
    }
  }

  run(request: RunRequest, options: { signal?: AbortSignal } = {}): AsyncIterable<RunEvent> {
    const stream = new EventStream();
    void this.start(request, stream);
    return stream.read(options.signal);
  }

  private async start(req: RunRequest, stream: EventStream) {
    const key = `${req.kernel}|${req.language}`;
    const t0 = Date.now();
    if (this.disposed || !this.languages.includes(req.language)) {
      stream.push({ type: "error", name: "SandboxError", message: `This Sandbox can't run ${req.language}` });
      stream.push({ type: "exit", ok: false, ms: 0 });
      return stream.end();
    }
    let code: string;
    try {
      code = await this.options.prepare(req.language, req.code);
    } catch (err) {
      const e = err as Error;
      stream.push({ type: "error", name: e?.name ?? "Error", message: String(e?.message ?? err) });
      stream.push({ type: "exit", ok: false, ms: Date.now() - t0 });
      return stream.end();
    }
    const state = this.state(key);
    const previous = state.queue;
    let release!: () => void;
    state.queue = new Promise<void>((r) => (release = r));
    await previous;
    try {
      if (this.disposed) {
        stream.push({ type: "restarted", reason: "stopped" });
        return stream.end();
      }
      clearTimeout(state.idleTimer);
      if (state.idleRestarted) {
        state.idleRestarted = false;
        stream.push({ type: "restarted", reason: "idle" });
      }
      const run: ActiveRun = { runId: ++this.seq, key, stream };
      state.active = run;
      this.runs.set(run.runId, run);
      try {
        await this.port();
      } catch (err) {
        stream.push({ type: "error", name: "SandboxError", message: `The Sandbox didn't start: ${(err as Error)?.message ?? err}` });
        stream.push({ type: "exit", ok: false, ms: Date.now() - t0 });
        this.finish(run);
        return;
      }
      // Until the Kernel says the code started, allow for the runtime to download.
      run.timer = setTimeout(() => this.restartKey(key, "timeout"), this.options.loadTimeoutMs ?? 120_000);
      this.send({ type: "run", key, language: req.language, runId: run.runId, code });
      await stream.closed;
      state.active = null;
      this.scheduleIdle(key, state);
    } finally {
      release();
    }
  }

  async restart(kernel: string, language: SandboxLanguage): Promise<void> {
    this.restartKey(`${kernel}|${language}`, "stopped");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, state] of this.kernels) {
      clearTimeout(state.idleTimer);
      if (state.active) this.restartKey(key, "stopped");
    }
    this.send({ type: "dispose" });
    void this.frame?.then((f) => f.close(), () => {});
    this.frame = null;
  }
}

/** Accept the frame's port only from our own iframe, with the "null" origin a sandboxed iframe has. */
export function isFrameHandshake(event: Pick<MessageEvent, "source" | "origin" | "data" | "ports">, frame: Window | null): boolean {
  return (
    !!frame &&
    event.source === frame &&
    event.origin === "null" &&
    (event.data as { type?: string } | null)?.type === "zr-sandbox-ready" &&
    event.ports.length === 1
  );
}
