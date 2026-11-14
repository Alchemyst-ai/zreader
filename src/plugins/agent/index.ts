/**
 * `zreader/plugins/agent` — opt-in plugins for `zreader/agent`, each scoped to
 * the bookshelf it is declared on.
 *
 *   // reader.config.ts
 *   import { cors, frontmatter, llmsTxt, mcp, notFound } from "zreader/plugins/agent";
 *
 * Factories return plain descriptors and load their converters lazily, so
 * `reader.config.ts` stays cheap to load inside `next.config`.
 */
export { disable } from "./disable";
export { frontmatter, type FrontmatterOptions } from "./frontmatter";
export { llmsTxt, type LlmsTxtPluginOptions } from "./llms-txt";
export { notFound, type NotFoundOptions } from "./not-found";
export { cors, type CorsOptions } from "./cors";
export { mcp, type McpOptions, type SearchHit } from "./mcp";
export type {
  AgentDocument,
  AgentPlugin,
  AgentPluginContext,
  AgentPluginMethod,
  AgentPluginRoute,
  DocumentMeta,
  NotFoundInfo,
} from "./types";
