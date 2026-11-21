import { describe, expect, it } from "vitest";
import { SW_HEADERS, serviceWorkerScript } from "../src/sw/index";
import { serviceWorkerRoute } from "../src/next/server/index";

type Handler = (event: Record<string, unknown>) => void;

/** A minimal service worker global: listeners, Cache API in memory, and a fake network. */
function harness(network: Record<string, { body: string; type: string }>) {
  const listeners: Record<string, Handler[]> = {};
  const store = new Map<string, Response>();
  let online = true;
  const keyOf = (r: string | Request) => (typeof r === "string" ? new URL(r, "https://x.dev").href : r.url).split("#")[0]!;
  const cache = {
    async put(r: string | Request, res: Response) {
      store.set(keyOf(r), res.clone());
    },
    async match(r: string | Request, opts?: { ignoreSearch?: boolean; ignoreVary?: boolean }) {
      let k = keyOf(r);
      // Like the real Cache API: a stored Vary: Accept response only matches the same Accept.
      const hit = store.get(opts?.ignoreSearch ? k.split("?")[0]! : k);
      if (hit?.headers.get("vary") && !opts?.ignoreVary && typeof r !== "string" && r.headers.get("accept") !== "*/*") return undefined;
      if (opts?.ignoreSearch) k = k.split("?")[0]!;
      return store.get(k)?.clone();
    },
    async delete(r: string) {
      return store.delete(keyOf(r));
    },
  };
  const self = {
    location: new URL("https://x.dev/zreader-sw.js"),
    addEventListener: (type: string, fn: Handler) => (listeners[type] ??= []).push(fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const fetchFn = async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    if (!online) throw new TypeError("offline");
    const hit = network[new URL(url).pathname + new URL(url).search];
    return hit ? new Response(hit.body, { headers: { "content-type": hit.type, vary: "Accept" } }) : new Response("nope", { status: 404 });
  };
  new Function("self", "caches", "fetch", serviceWorkerScript())(self, { open: async () => cache }, fetchFn);

  async function message(data: unknown) {
    const replies: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    const port = { postMessage: (m: unknown) => replies.push(m) };
    for (const fn of listeners.message ?? []) fn({ data, ports: [port], waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return replies;
  }
  async function request(url: string, mode: string = "navigate") {
    let responded: Promise<Response> | undefined;
    const req = new Request(url, { headers: { accept: mode === "navigate" ? "text/html" : "image/avif,image/webp,*/*" } });
    Object.defineProperty(req, "mode", { value: mode });
    for (const fn of listeners.fetch ?? []) fn({ request: req, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded ? responded : null;
  }
  return { message, request, store, setOnline: (v: boolean) => (online = v) };
}

const network = {
  "/books/guide": { body: `<html><link href="/_next/static/css/a.css" rel="stylesheet"><a href="/books/guide/intro">Intro</a></html>`, type: "text/html" },
  "/books/guide/intro": {
    body: `<html><script src="/_next/static/chunks/app.js"></script><img src="/books/guide/_assets/abcdef1234/diagram.png" srcSet="/_next/image?url=%2Fx.png&amp;w=640 640w, /_next/image?url=%2Fx.png&amp;w=1080 1080w"><img src="https://cdn.other/x.png"></html>`,
    type: "text/html",
  },
  "/_next/static/css/a.css": { body: "body{}", type: "text/css" },
  "/_next/static/chunks/app.js": { body: "1", type: "text/javascript" },
  "/books/guide/_assets/abcdef1234/diagram.png": { body: "png", type: "image/png" },
  "/_next/image?url=%2Fx.png&w=640": { body: "img640", type: "image/png" },
  "/_next/image?url=%2Fx.png&w=1080": { body: "img1080", type: "image/png" },
};

describe("offline service worker", () => {
  it("saves pages with their scripts, styles and images, and reports status", async () => {
    const sw = harness(network);
    const replies = await sw.message({ type: "zr:save", key: "/books:guide", urls: ["/books/guide", "/books/guide/intro"] });
    expect(replies.at(-1)).toEqual({ type: "zr:saved", saved: 7, failed: 0 });
    expect([...sw.store.keys()].filter((k) => !k.includes("__zreader__")).sort()).toEqual(
      [
        "https://x.dev/_next/image?url=%2Fx.png&w=1080",
        "https://x.dev/_next/image?url=%2Fx.png&w=640",
        "https://x.dev/_next/static/chunks/app.js",
        "https://x.dev/_next/static/css/a.css",
        "https://x.dev/books/guide",
        "https://x.dev/books/guide/_assets/abcdef1234/diagram.png",
        "https://x.dev/books/guide/intro",
      ].sort(),
    );
    expect((await sw.message({ type: "zr:status", key: "/books:guide" }))[0]).toMatchObject({ type: "zr:status", saved: true, count: 7 });
  });

  it("serves saved pages offline and a notice for unsaved ones", async () => {
    const sw = harness(network);
    await sw.message({ type: "zr:save", key: "k", urls: ["/books/guide/intro"] });
    sw.setOnline(false);
    expect(await (await sw.request("https://x.dev/books/guide/intro"))!.text()).toContain("diagram.png");
    expect(await (await sw.request("https://x.dev/_next/static/chunks/app.js", "no-cors"))!.text()).toBe("1");
    // An <img> asks with its own Accept header; the saved copy still answers.
    expect(await (await sw.request("https://x.dev/_next/image?url=%2Fx.png&w=640", "no-cors"))!.text()).toBe("img640");
    const unsaved = (await sw.request("https://x.dev/books/guide/other"))!;
    expect(unsaved.status).toBe(503);
    expect(await unsaved.text()).toContain("wasn't saved for offline reading");
  });

  it("leaves other requests alone and removes only files no other book uses", async () => {
    const sw = harness(network);
    expect(await sw.request("https://cdn.other/x.png", "no-cors")).toBeNull();
    await sw.message({ type: "zr:save", key: "a", urls: ["/books/guide"] });
    await sw.message({ type: "zr:save", key: "b", urls: ["/books/guide/intro"] });
    const [removed] = await sw.message({ type: "zr:remove", key: "a" });
    // /books/guide and its CSS were only in "a".
    expect(removed).toEqual({ type: "zr:removed", removed: 2 });
    expect(sw.store.has("https://x.dev/books/guide/intro")).toBe(true);
    expect((await sw.message({ type: "zr:status", key: "a" }))[0]).toMatchObject({ saved: false });
  });

  it("is served with the right headers by the Next.js route", async () => {
    const res = serviceWorkerRoute().GET();
    expect(res.headers.get("content-type")).toBe(SW_HEADERS["Content-Type"]);
    expect(res.headers.get("service-worker-allowed")).toBe("/");
    expect(await res.text()).toContain('self.addEventListener("fetch"');
  });
});
