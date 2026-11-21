/**
 * Turn compiled (already sanitized) chapter HTML into React elements, so
 * components such as `next/image` can render images. Server/build only.
 */
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import type { MdxComponents } from "./pipeline";

export interface HtmlToReactOptions {
  /** Replace elements by tag name: `{ img: MyImage }`. */
  components?: MdxComponents;
}

const parser = unified().use(rehypeParse, { fragment: true });

export function htmlToReact(html: string, options: HtmlToReactOptions = {}): ReactNode {
  const tree = parser.parse(html);
  return toJsxRuntime(tree, {
    Fragment,
    jsx: jsx as never,
    jsxs: jsxs as never,
    components: (options.components ?? {}) as Partial<Components>,
    elementAttributeNameCase: "react",
    stylePropertyNameCase: "dom",
  }) as ReactNode;
}
