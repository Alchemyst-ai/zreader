import { compile, run } from "@mdx-js/mdx";
import * as jsxRuntime from "react/jsx-runtime";
import rehypeParse from "rehype-parse";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type PluggableList } from "unified";
import type { ComponentType } from "react";
import type { SanitizeOptions } from "../config/index";
import { rehypeBlocks, type BlocksData } from "../rehype/index";
import { sanitizeHtml } from "./sanitize";

export type ChapterFormat = "md" | "mdx" | "html";

export interface PipelineOptions {
  sanitize?: SanitizeOptions;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
}

export interface HtmlResult extends BlocksData {
  kind: "html";
  html: string;
}

export interface MdxCompiled extends BlocksData {
  kind: "mdx";
  /** Compiled function body; run with `runMdx`. Serializable (cacheable). */
  code: string;
}

/** Add block ids / heading ids / TOC to already-sanitized HTML. */
export async function annotateHtml(html: string): Promise<HtmlResult> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeBlocks)
    .use(rehypeStringify)
    .process(html);
  return { kind: "html", html: String(file), ...(file.data as { reader: BlocksData }).reader };
}

/** Untrusted HTML string → sanitized, annotated HTML. */
export async function renderHtml(html: string, opts: PipelineOptions = {}): Promise<HtmlResult> {
  return annotateHtml(sanitizeHtml(html, opts.sanitize));
}

/**
 * Markdown (GFM, inline HTML allowed) → sanitized, annotated HTML.
 * Inline HTML is parsed, then the whole output goes through DOMPurify.
 */
export async function renderMarkdown(markdown: string, opts: PipelineOptions = {}): Promise<HtmlResult> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(opts.remarkPlugins ?? [])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(opts.rehypePlugins ?? [])
    .use(rehypeStringify)
    .process(markdown);
  return renderHtml(String(file), opts);
}

/**
 * Trusted MDX → compiled function body. MDX is code: only compile files you
 * author (e.g. from your repo), never user-supplied input.
 */
export async function compileMdx(source: string, opts: PipelineOptions = {}): Promise<MdxCompiled> {
  const file = await compile(source, {
    outputFormat: "function-body",
    development: false,
    remarkPlugins: [remarkGfm, ...(opts.remarkPlugins ?? [])],
    rehypePlugins: [...(opts.rehypePlugins ?? []), rehypeBlocks],
  });
  return { kind: "mdx", code: String(file), ...(file.data as { reader: BlocksData }).reader };
}

export type MdxComponents = Record<string, ComponentType<Record<string, unknown>>>;
export type MdxContent = ComponentType<{ components?: MdxComponents }>;

const mdxModuleCache = new Map<string, Promise<MdxContent>>();

export function runMdx(code: string): Promise<MdxContent> {
  let p = mdxModuleCache.get(code);
  if (!p) {
    p = run(code, { ...(jsxRuntime as unknown as Record<string, unknown>), baseUrl: import.meta.url } as never).then((m) => m.default as MdxContent);
    mdxModuleCache.set(code, p);
    if (mdxModuleCache.size > 200) mdxModuleCache.delete(mdxModuleCache.keys().next().value!);
  }
  return p;
}
