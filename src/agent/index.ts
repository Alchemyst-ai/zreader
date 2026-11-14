/**
 * `zreader/agent` — agent-readable Markdown for every book and chapter
 * (server-only). Works with any server that speaks `Request`/`Response`:
 *
 *   // Next.js: proxy.ts (Next 16) or middleware.ts with runtime "nodejs" (15.5+)
 *   const agent = createAgentHandler();
 *   export async function proxy(req: Request) { return (await agent(req)) ?? NextResponse.next(); }
 *
 * Plugins (frontmatter, `llms.txt`, the rich 404, CORS, MCP) live in
 * `zreader/plugins/agent`.
 */
export {
  createAgentHandler,
  matchAgentRoute,
  requestOrigin,
  type AgentContentSource,
  type AgentHandler,
  type AgentHandlerOptions,
  type AgentRouteMatch,
} from "./handler";
export {
  bookToMarkdown,
  chapterBodyToMarkdown,
  chapterToMarkdown,
  demoteHeadings,
  fullTextToMarkdown,
  htmlToMarkdown,
  isValidFrontmatterKey,
  llmsTxt,
  markdownPageUrl,
  mdxToMarkdown,
  newestBookLastUpdated,
  newestLastUpdated,
  notFoundToMarkdown,
  pageUrl,
  renderFrontmatter,
  resolveLastUpdated,
  shelfToMarkdown,
  type AgentUrlContext,
  type LastUpdatedInput,
  type LlmsTxtOptions,
  type NotFoundMarkdownOptions,
  type ShelfOptions,
} from "./markdown";
export type {
  AgentDocument,
  AgentPlugin,
  AgentPluginContext,
  AgentPluginMethod,
  AgentPluginRoute,
  DocumentMeta,
  NotFoundInfo,
} from "../plugins/agent/types";
