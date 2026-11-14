/**
 * `zreader/agent/react` — client components for agent references.
 *
 *   <Reader … actions={<CopyReference markdown />} />
 */
export { CopyReference, type CopyReferenceProps } from "./copy-reference";
export { MarkdownAlternate, markdownHref } from "./markdown-alternate";
export {
  DEFAULT_ASK_PROMPT,
  DEFAULT_PROMPT,
  DEFAULT_PROVIDERS,
  PROVIDERS,
  formatPrompt,
  markdownUrl,
  providerUrl,
  resolveProvider,
  type BuiltInProvider,
  type ProviderSpec,
} from "./reference";
