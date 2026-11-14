import type { AgentPlugin } from "./types";

export interface CorsOptions {
  /** `Access-Control-Allow-Origin`. Default "*". */
  origin?: string;
  /** Vary values, joined with ", ". Default none. */
  vary?: string | string[];
  /** `Access-Control-Max-Age` for preflights. Default 86400. */
  maxAge?: number;
}

/** Headers a browser MCP client or extension may send. */
const ALLOW_HEADERS = "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version";

/**
 * CORS for every response this shelf produces: twins, 404s, `llms*.txt`, MCP.
 *
 * Opt-in because the documents are public and the Copy Reference flow does not
 * need it (it opens `chatgpt.com/?q=…`, and the assistant fetches server-side).
 * Browser-side agents, extensions and browser MCP clients do.
 */
export function cors(opts: CorsOptions = {}): AgentPlugin {
  const origin = opts.origin ?? "*";
  const extra = opts.vary == null ? [] : Array.isArray(opts.vary) ? opts.vary : [opts.vary];
  // A specific origin makes the response depend on the request, so caches must vary.
  const vary = [...extra, ...(origin === "*" ? [] : ["Origin"])];
  const maxAge = String(opts.maxAge ?? 86400);

  return {
    name: "cors",

    routes: [
      {
        path: "*",
        methods: ["OPTIONS"],
        handle: (_request, ctx) => {
          const res = ctx.respond(null, { status: 204, type: "text/plain" });
          const methods = (ctx.methods ?? []).join(", ");
          res.headers.set("Allow", methods);
          res.headers.set("Access-Control-Allow-Methods", methods);
          res.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
          res.headers.set("Access-Control-Max-Age", maxAge);
          return res;
        },
      },
    ],

    headers(h) {
      h.set("Access-Control-Allow-Origin", origin);
      if (vary.length) h.set("Vary", vary.join(", "));
    },
  };
}
