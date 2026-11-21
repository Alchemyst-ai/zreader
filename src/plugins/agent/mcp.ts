/**
 * `mcp()` — a stateless MCP server over the Streamable HTTP transport
 * (JSON-RPC 2.0 over `POST`), hand-rolled: no dependency on
 * `@modelcontextprotocol/sdk`.
 *
 * `GET` and `DELETE` are not handled, so they fall through to the app: a book
 * with the id `mcp` keeps its HTML page at `GET {basePath}/mcp`.
 *
 * Read-only tools over public content; no auth. Rate limiting or auth belongs in
 * the app's own proxy.
 */
import type { BookEntry } from "zreader/content";
import type { AgentPlugin, AgentPluginContext, AgentPluginRoute } from "./types";

/** The MCP revision implemented here. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_VERSION = "0.4.0";

/** One hit of the default BM25 search. */
export interface SearchHit {
  book: string;
  chapter: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
}

export type McpToolName = "list_books" | "get_book" | "get_chapter" | "search";

export interface McpOptions {
  /** Route, relative to `basePath`. Default "/mcp". */
  path?: string;
  /** Server name in `initialize`. Default `zreader-${shelf.id}`. */
  name?: string;
  /** Replace the default search. */
  search?: (
    query: string,
    books: BookEntry[],
    opts: { book?: string; limit: number },
  ) => Promise<SearchHit[]> | SearchHit[];
  /** Disable individual tools. */
  tools?: Partial<Record<McpToolName, boolean>>;
}

const TOOLS: Record<McpToolName, { description: string; inputSchema: Record<string, unknown> }> = {
  list_books: {
    description: "Every book on this shelf, with its chapters. Use it to find ids before reading.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  get_book: {
    description: "A book's table of contents as Markdown.",
    inputSchema: {
      type: "object",
      properties: { book: { type: "string", description: "Book id" } },
      required: ["book"],
      additionalProperties: false,
    },
  },
  get_chapter: {
    description: "One chapter as Markdown, with prev / contents / next links.",
    inputSchema: {
      type: "object",
      properties: {
        book: { type: "string", description: "Book id" },
        chapter: { type: "string", description: "Chapter id" },
      },
      required: ["book", "chapter"],
      additionalProperties: false,
    },
  },
  search: {
    description: "Search this shelf's chapters. Returns the best-matching chapters with a snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        book: { type: "string", description: "Limit the search to one book id" },
        limit: { type: "integer", minimum: 1, description: "Maximum hits (default 10)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function idOf(msg: unknown): string | number | null {
  const id = isObject(msg) ? msg.id : undefined;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function error(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function result(id: string | number | null, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function text(id: string | number | null, body: string, isError = false) {
  return result(id, { content: [{ type: "text", text: body }], ...(isError ? { isError: true } : {}) });
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

async function runTool(
  name: McpToolName,
  args: Record<string, unknown>,
  ctx: AgentPluginContext,
  opts: McpOptions,
): Promise<{ text: string; isError?: boolean }> {
  switch (name) {
    case "list_books": {
      const books = await ctx.api.getBooks();
      return {
        text: JSON.stringify(
          books.map((b) => ({
            id: b.id,
            title: b.title,
            ...(b.subtitle ? { subtitle: b.subtitle } : {}),
            authors: b.authors,
            ...(b.description ? { description: b.description } : {}),
            chapters: b.chapters.map((c) => ({
              id: c.id,
              title: c.title,
              ...(c.label ? { label: c.label } : {}),
              ...(c.description ? { description: c.description } : {}),
            })),
          })),
          null,
          2,
        ),
      };
    }
    case "get_book": {
      const doc = await ctx.document({ kind: "book", book: str(args, "book") });
      return { text: doc.preamble.join("") + doc.body, ...(doc.kind === "notFound" ? { isError: true } : {}) };
    }
    case "get_chapter": {
      const doc = await ctx.document({
        kind: "chapter",
        book: str(args, "book"),
        chapter: str(args, "chapter"),
      });
      return { text: doc.preamble.join("") + doc.body, ...(doc.kind === "notFound" ? { isError: true } : {}) };
    }
    case "search": {
      const limitRaw = args.limit;
      const limit = typeof limitRaw === "number" && limitRaw > 0 ? Math.floor(limitRaw) : 10;
      const book = str(args, "book") || undefined;
      const query = str(args, "query");
      const books = await ctx.api.getBooks();
      const hits = opts.search
        ? await opts.search(query, books, { book, limit })
        : await (await import("./mcp-search")).searchChapters(ctx, query, { book, limit });
      return { text: JSON.stringify(hits, null, 2) };
    }
  }
}

async function handleMessage(msg: unknown, ctx: AgentPluginContext, opts: McpOptions): Promise<unknown | null> {
  if (!isObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return error(idOf(msg), -32600, "Invalid Request");
  }
  const id = idOf(msg);
  const notification = !("id" in msg);
  // Never answer a notification (`notifications/initialized` → 202, no body).
  if (notification) return null;

  switch (msg.method) {
    case "initialize":
      return result(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: opts.name ?? `zreader-${ctx.shelf.id}`, version: SERVER_VERSION },
      });
    case "ping":
      return result(id, {});
    case "tools/list": {
      const enabled = { list_books: true, get_book: true, get_chapter: true, search: true, ...opts.tools };
      const tools = (Object.keys(TOOLS) as McpToolName[])
        .filter((n) => enabled[n])
        .map((n) => ({ name: n, description: TOOLS[n].description, inputSchema: TOOLS[n].inputSchema }));
      return result(id, { tools });
    }
    case "tools/call": {
      const params = msg.params;
      const name = isObject(params) ? params.name : undefined;
      const enabled = { list_books: true, get_book: true, get_chapter: true, search: true, ...opts.tools };
      if (typeof name !== "string" || !(name in TOOLS) || !enabled[name as McpToolName]) {
        return error(id, -32602, `Unknown tool: ${String(name)}`);
      }
      const args = isObject(params) && isObject(params.arguments) ? params.arguments : {};
      try {
        const out = await runTool(name as McpToolName, args, ctx, opts);
        return text(id, out.text, out.isError);
      } catch (e) {
        return text(id, `zreader: ${(e as Error).message}`, true);
      }
    }
    default:
      return error(id, -32601, `Method not found: ${msg.method}`);
  }
}

async function handlePost(request: Request, ctx: AgentPluginContext, opts: McpOptions): Promise<Response> {
  const respond = (body: unknown, status = 200) => ctx.respond(JSON.stringify(body), { status, type: "application/json" });
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return respond(error(null, -32700, "Parse error"));
  }
  const batch = Array.isArray(payload) ? payload : [payload];
  if (!batch.length) return respond(error(null, -32600, "Invalid Request"));

  const out: unknown[] = [];
  for (const msg of batch) {
    const res = await handleMessage(msg, ctx, opts);
    if (res !== null) out.push(res);
  }
  if (!out.length) return new Response(null, { status: 202 });
  return respond(Array.isArray(payload) ? out : out[0]);
}

/**
 * A stateless MCP server at `POST {basePath}/mcp` with four read-only tools:
 * `list_books`, `get_book`, `get_chapter` and `search`.
 */
export function mcp(opts: McpOptions = {}): AgentPlugin {
  const routes: AgentPluginRoute[] = [
    {
      path: opts.path ?? "/mcp",
      methods: ["POST"],
      handle: (request, ctx) => handlePost(request, ctx, opts),
    },
  ];
  return { name: "mcp", routes };
}
