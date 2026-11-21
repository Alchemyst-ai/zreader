/** `srcset` parsing that keeps commas inside URLs (data URIs). No Node APIs. */
export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

/** Parses `srcset`, keeping commas inside URLs (data URIs). */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && (value[i] === "," || /\s/.test(value[i]!))) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !/\s/.test(value[i]!)) i++;
    let url = value.slice(start, i);
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      start = i;
      while (i < n && value[i] !== ",") i++;
      descriptor = value.slice(start, i).trim();
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

export function stringifySrcset(list: SrcsetCandidate[]): string {
  return list.map((c) => (c.descriptor ? `${c.url} ${c.descriptor}` : c.url)).join(", ");
}

