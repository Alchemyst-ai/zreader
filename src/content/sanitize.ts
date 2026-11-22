import DOMPurify from "isomorphic-dompurify";
import type { SanitizeOptions } from "../config/index";
import { RUNNABLE_ID, SANDBOX_LANGUAGES } from "zreader";
import { parseSrcset, stringifySrcset } from "./srcset";

const FORBID_TAGS = ["style", "form", "button", "textarea", "select", "option", "object", "embed", "base", "link", "meta"];
const FORBID_ATTR = ["style"];
/** Image attributes zreader relies on (sizes, responsive sources, lazy loading). */
const IMAGE_ATTR = ["srcset", "sizes", "width", "height", "loading", "decoding"];
const SCRIPT_URL = /^\s*(?:javascript|vbscript|data:(?!image\/))/i;

function hostAllowed(src: string, allow: string[]): boolean {
  try {
    const u = new URL(src, "https://invalid.local");
    if (u.protocol !== "https:") return false;
    return allow.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Sanitize untrusted HTML with DOMPurify (html profile, no scripts, no event
 * handlers, no javascript: URLs, no inline styles, no forms). Iframes are
 * stripped unless their https host is in `allowIframes`. External links opened
 * in a new tab get `rel="noopener noreferrer"`. Inline `<svg>` is kept only with
 * `svg: true`; MathML only when math is enabled (`mathMl`).
 *
 * Image *policy* (remote hosts, data-URI sizes) is applied afterwards by
 * `rehypeImages`; here `srcset` candidates with script URLs are dropped.
 */
/** RunnableCode markers (`rehypeRunnable`), kept only on `pre` and only with valid values. */
const RUNNABLE_ATTR = ["data-zr-runnable", "data-zr-runnable-id", "data-zr-output-for"];
const RUNNABLE_VALUE: Record<string, (v: string) => boolean> = {
  "data-zr-runnable": (v) => (SANDBOX_LANGUAGES as readonly string[]).includes(v),
  "data-zr-runnable-id": (v) => RUNNABLE_ID.test(v),
  "data-zr-output-for": (v) => RUNNABLE_ID.test(v),
};

export function sanitizeHtml(html: string, options: SanitizeOptions = {}, internal: { mathMl?: boolean; runnable?: boolean } = {}): string {
  const allowIframes = options.allowIframes ?? [];
  const addTags = [...(options.allowTags ?? []), ...(allowIframes.length ? ["iframe"] : [])];
  const addAttr = ["target", ...(internal.runnable ? RUNNABLE_ATTR : []), ...IMAGE_ATTR, ...(options.allowAttributes ?? []), ...(allowIframes.length ? ["allowfullscreen", "loading"] : [])];

  const purify = DOMPurify;
  purify.addHook("uponSanitizeElement", (node, data) => {
    // GFM task lists render checkboxes; any other input is dropped.
    if (data.tagName === "input" && (node as Element).getAttribute?.("type") !== "checkbox") {
      (node as Element).parentNode?.removeChild(node as Element);
      return;
    }
    if (data.tagName === "iframe") {
      const el = node as Element;
      const src = el.getAttribute?.("src") ?? "";
      if (!hostAllowed(src, allowIframes)) el.parentNode?.removeChild(el);
    }
  });
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const rule = RUNNABLE_VALUE[data.attrName];
    if (rule) {
      if ((node as Element).tagName !== "PRE" || !rule(data.attrValue)) data.keepAttr = false;
      return;
    }
    if (data.attrName !== "srcset") return;
    const kept = parseSrcset(data.attrValue).filter((c) => !SCRIPT_URL.test(c.url));
    if (kept.length) data.attrValue = stringifySrcset(kept);
    else data.keepAttr = false;
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.hasAttribute?.("target")) {
      if (el.tagName === "A" && el.getAttribute("target") === "_blank") el.setAttribute("rel", "noopener noreferrer");
      else el.removeAttribute("target");
    }
    if (el.tagName === "IFRAME") {
      el.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
      el.setAttribute("loading", "lazy");
    }
    if (el.tagName === "INPUT") {
      for (const a of Array.from(el.attributes)) if (!["type", "checked", "disabled"].includes(a.name)) el.removeAttribute(a.name);
      el.setAttribute("disabled", "");
    }
    // Block ids are ours to assign.
    el.removeAttribute?.("data-block-id");
  });
  try {
    return purify.sanitize(html, {
      USE_PROFILES: { html: true, svg: Boolean(options.svg), svgFilters: Boolean(options.svg), mathMl: Boolean(internal.mathMl) },
      ADD_TAGS: addTags,
      ADD_ATTR: addAttr,
      FORBID_TAGS: FORBID_TAGS.filter((t) => !addTags.includes(t)),
      FORBID_ATTR: FORBID_ATTR.filter((a) => !addAttr.includes(a)),
      ALLOW_DATA_ATTR: false,
    }) as unknown as string;
  } finally {
    purify.removeHook("uponSanitizeElement");
    purify.removeHook("uponSanitizeAttribute");
    purify.removeHook("afterSanitizeAttributes");
  }
}
