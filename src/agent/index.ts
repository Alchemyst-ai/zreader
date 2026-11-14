/**
 * `zreader/agent` — agent-readable Markdown for every book and chapter
 * (server-only). Works with any server that speaks `Request`/`Response`:
 *
 *   // Next.js: proxy.ts (Next 16) or middleware.ts with runtime "nodejs" (15.5+)
 *   const agent = createAgentHandler();
 *   export async function proxy(req: Request) { return (await agent(req)) ?? NextResponse.next(); }
 */
export {
  createAgentHandler,
  matchAgentRoute,
  requestOrigin,
  type AgentContentSource,
  type AgentHandler,
  type AgentHandlerOptions,
} from "./handler";
export {
  bookToMarkdown,
  chapterBodyToMarkdown,
  chapterToMarkdown,
  htmlToMarkdown,
  llmsTxt,
  markdownPageUrl,
  mdxToMarkdown,
  pageUrl,
  shelfToMarkdown,
  type AgentUrlContext,
  type LlmsTxtOptions,
} from "./markdown";
