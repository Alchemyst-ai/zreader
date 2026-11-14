import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineBooks } from "../src/content/index";
import { glob, resolveConfig } from "../src/config/index";
import { createAgentHandler } from "../src/agent/index";
import { cors, disable } from "../src/plugins/agent/index";
import type { AgentDocument, AgentPlugin } from "../src/plugins/agent/types";

// The plugin examples from docs/plugins.md, run so the guide cannot rot.
const robots = (): AgentPlugin => ({ name: "robots", headers(h) { h.set("X-Robots-Tag", "noindex"); } });

function cacheFor(path: string, value: string): AgentPlugin {
  return {
    name: `cacheFor(${path})`,
    headers(headers, ctx) {
      if (ctx.status !== 200) return;
      if (new URL(ctx.request.url).pathname !== path) return;
      headers.set("Cache-Control", value);
    },
  };
}

function wordCount(): AgentPlugin {
  return {
    name: "wordCount",
    document(doc) {
      if (doc.kind !== "chapter") return doc;
      const words = doc.body.split(/\s+/).filter(Boolean).length;
      return { ...doc, body: `${doc.body}\n\n---\n\n_${words} words._\n` };
    },
  };
}

function tocJson(): AgentPlugin {
  return {
    name: "tocJson",
    routes: [
      {
        path: "/toc.json",
        handle: async (_request, ctx) => {
          const books = await ctx.api.getBooks();
          const json = books.map((book) => ({
            id: book.id,
            title: book.title,
            url: `${ctx.url.origin}${ctx.url.basePath}/${book.id}`,
            chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, label: c.label })),
          }));
          return ctx.respond(JSON.stringify(json, null, 2), { type: "application/json" });
        },
      },
    ],
  };
}

function canonicalHost(host: string): AgentPlugin {
  return {
    name: "canonicalHost",
    setup() {
      if (!/^[\w.-]+(:\d+)?$/.test(host)) throw new Error(`canonicalHost: "${host}" is not a host`);
    },
    headers(headers, ctx) {
      const canonical = headers.get("link");
      if (ctx.status !== 200 || !canonical) return;
      headers.set("Link", canonical.replace(/(<https?:\/\/)[^/]+/, `$1${host}`));
    },
  };
}
// ---- end examples

const ORIGIN = "https://example.com";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zr-plugins-"));
  const dir = join(root, "content/books/guide");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "book.json"), JSON.stringify({ title: "The Guide", authors: ["A. Writer"] }));
  writeFileSync(join(dir, "01-intro.md"), "---\ntitle: Introduction\nlabel: Chapter 1\n---\n\nHello **world**.\n");
  return root;
}

function agentFor(plugins: AgentPlugin[], basePath = "/books") {
  const root = fixture();
  const config = resolveConfig({ content: { loader: glob({ base: "./content/books" }) } }, null, { root });
  const shelf = { ...config.shelves[0]!, basePath, plugins };
  return createAgentHandler({ origin: ORIGIN, sources: [{ shelf, api: defineBooks(config) }] });
}

describe("agent plugins (authoring)", () => {
  it("headers: robots()", async () => {
    const res = await (await agentFor([robots()])(new Request(`${ORIGIN}/books.md`)))!;
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("headers: cacheFor()", async () => {
    const agent = agentFor([cacheFor("/books.md", "public, max-age=3600")]);
    expect((await agent(new Request(`${ORIGIN}/books.md`)))!.headers.get("cache-control")).toBe("public, max-age=3600");
    // Other paths keep the handler's default.
    expect((await agent(new Request(`${ORIGIN}/books/guide.md`)))!.headers.get("cache-control")).toContain("s-maxage");
    // 404s are untouched.
    expect((await agent(new Request(`${ORIGIN}/books/nope.md`)))!.headers.get("cache-control")).toBe("no-store");
  });

  it("document: wordCount()", async () => {
    const res = await (await agentFor([wordCount()])(new Request(`${ORIGIN}/books/guide/intro.md`)))!;
    const body = await res.text();
    expect(body).toMatch(/^# Introduction\n\nHello \*\*world\*\*\./);
    expect(body).toContain("- Contents: [The Guide]");
    expect(body.trimEnd()).toMatch(/_\d+ words\._$/);
  });

  it("routes: tocJson()", async () => {
    const res = await (await agentFor([tocJson(), cors()])(new Request(`${ORIGIN}/books/toc.json`)))!;
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*"); // cors() sees plugin routes
    const json = JSON.parse(await res.text());
    expect(json[0]).toMatchObject({ id: "guide", title: "The Guide", url: `${ORIGIN}/books/guide` });
    expect(json[0].chapters).toEqual([{ id: "intro", title: "Introduction", label: "Chapter 1" }]);
  });

  it("routes: HEAD is handled", async () => {
    const res = await (await agentFor([tocJson()])(new Request(`${ORIGIN}/books/toc.json`, { method: "HEAD" })))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("setup: canonicalHost() rewrites the canonical link, and rejects a bad host", async () => {
    const res = await (await agentFor([canonicalHost("cdn.example.com")])(new Request(`${ORIGIN}/books/guide/intro.md`)))!;
    expect(res.headers.get("link")).toBe(`<https://cdn.example.com/books/guide/intro>; rel="canonical"`);
    await expect(agentFor([canonicalHost("not a host")])(new Request(`${ORIGIN}/books.md`))).rejects.toThrow(
      /agent plugin "canonicalHost" failed setup/,
    );
  });

  it("ctx.document() yields the same body as the twin, and a notFound document for a miss", async () => {
    let seen: AgentDocument | undefined;
    const probe = (): AgentPlugin => ({
      name: "probe",
      routes: [
        {
          path: "/probe",
          handle: async (_r, ctx) => {
            seen = await ctx.document({ kind: "chapter", book: "guide", chapter: "nope" });
            return ctx.respond("ok");
          },
        },
      ],
    });
    await (await agentFor([probe()])(new Request(`${ORIGIN}/books/probe`)))!;
    expect(seen!.kind).toBe("notFound");
    expect(seen!.notFound!.what).toBe("chapter");
    expect(seen!.body).toContain("# Not found");
  });

  it("disable() removes an inherited plugin", async () => {
    const root = fixture();
    const config = resolveConfig(
      { agent: { plugins: [robots()] }, bookshelves: [{ id: "books", basePath: "/books", agent: { plugins: [disable("robots")] } }] },
      null,
      { root },
    );
    expect(config.shelves[0]!.plugins).toEqual([]);
  });
});
