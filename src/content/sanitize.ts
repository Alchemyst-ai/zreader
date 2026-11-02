import DOMPurify from "isomorphic-dompurify";
import type { SanitizeOptions } from "../config/index";

const FORBID_TAGS = ["style", "form", "button", "textarea", "select", "option", "object", "embed", "base", "link", "meta"];
const FORBID_ATTR = ["style", "srcset"];

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
 * in a new tab get `rel="noopener noreferrer"`.
 */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const allowIframes = options.allowIframes ?? [];
  const addTags = [...(options.allowTags ?? []), ...(allowIframes.length ? ["iframe"] : [])];
  const addAttr = ["target", ...(options.allowAttributes ?? []), ...(allowIframes.length ? ["allowfullscreen", "loading"] : [])];

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
      USE_PROFILES: { html: true },
      ADD_TAGS: addTags,
      ADD_ATTR: addAttr,
      FORBID_TAGS: FORBID_TAGS.filter((t) => !addTags.includes(t)),
      FORBID_ATTR: FORBID_ATTR.filter((a) => !addAttr.includes(a)),
      ALLOW_DATA_ATTR: false,
    }) as unknown as string;
  } finally {
    purify.removeHook("uponSanitizeElement");
    purify.removeHook("afterSanitizeAttributes");
  }
}
