import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod/v4";
import { DEFAULT_CLIENT_OPTIONS } from "../core/defaults";
import {
  FONT_FAMILIES,
  HIGHLIGHT_COLORS,
  LEADINGS,
  MEASURES,
  TEXT_SIZES,
  THEMES,
  type ReaderClientOptions,
} from "../core/types";
import type { AgentPlugin } from "../plugins/agent/types";

export { z };

// ---------------------------------------------------------------- types

export interface GlobLoader {
  kind: "glob";
  /** Directory containing one folder per book. Relative to the project root. */
  base: string;
  /** Chapter files, relative to `base`. */
  pattern: string | string[];
  ignore?: string[];
}

/** Astro-style glob loader: `content/books/<book>/{book.json, 01-intro.md, ...}` */
export function glob(opts: { base: string; pattern?: string | string[]; ignore?: string[] }): GlobLoader {
  return { kind: "glob", base: opts.base, pattern: opts.pattern ?? "**/*.{md,mdx,html}", ignore: opts.ignore };
}

// unified's PluggableList, kept loose to avoid a type dependency in this entry.
export type PluginList = unknown[];

export interface SanitizeOptions {
  /** Hostnames allowed for <iframe src>. Iframes are stripped unless listed here. */
  allowIframes?: string[];
  /** Extra tags to allow on top of DOMPurify's safe HTML profile. */
  allowTags?: string[];
  /** Extra attributes to allow. */
  allowAttributes?: string[];
  /** Keep inline `<svg>` (DOMPurify's SVG profile). Off by default. */
  svg?: boolean;
}

export interface ImageOptions {
  /** Remote (`http(s)`) image URLs: `true` for any host, `false` for none, or a host allowlist (subdomains included). */
  allowRemote: boolean | string[];
  /** Inline `data:image/*;base64` URIs. */
  allowDataUri: boolean;
  /** Largest decoded size of one inline image, in bytes. Larger ones are dropped with a warning. Default 8 MB. */
  maxDataUriBytes: number;
  /** Largest total of inline images in one chapter, in bytes. Images past it are dropped with a warning. No limit by default. */
  maxDataUriTotalBytes?: number;
  /** In development, warn when a chapter's inline images add up to more than this. Default 2 MB. */
  warnDataUriTotalBytes: number;
  /** Allow `data:image/svg+xml` URIs. */
  allowSvgDataUri: boolean;
  /** Fetch the first bytes of remote images at compile time to learn their size. Needs network during builds. */
  probeRemote: boolean;
  /** Timeout for one remote probe. */
  probeTimeoutMs: number;
  /** Add `loading="lazy"` and `decoding="async"`. */
  lazy: boolean;
  /** Open block images in a full-screen viewer on tap. */
  lightbox: boolean;
  /** Turn a lone image's title into a `<figure>` with a `<figcaption>`. */
  captions: boolean;
}

export interface AssetOptions {
  /** URL segment for book assets: `{basePath}/{book}/{route}/…`. */
  route: string;
  /** File extensions served from a book folder. */
  extensions: string[];
}

export const MATH_ENGINES = ["katex", "temml", "mathjax"] as const;
export type MathEngine = (typeof MATH_ENGINES)[number];

export interface MathConfig {
  engine: MathEngine;
  /** Options passed to the engine (KaTeX/Temml render options, MathJax TeX input options). */
  options?: Record<string, unknown>;
  /** TeX macros shared by every engine: `{ "\\RR": "\\mathbb{R}" }`. */
  macros?: Record<string, string>;
}

/** `false` (default) turns math off. Every engine renders MathML. */
export type MathOption = false | MathEngine | MathConfig;

export interface ContentConfig {
  loader: GlobLoader;
  schemas: { book: z.ZodType; chapter: z.ZodType };
  /** Applied to `.md` and `.mdx`. */
  remarkPlugins: PluginList;
  rehypePlugins: PluginList;
  sanitize: SanitizeOptions;
  /** Image sources, sizes, captions and the viewer. */
  images: ImageOptions;
  /** Files served from inside book folders (images next to chapters). */
  assets: AssetOptions;
  /** TeX math. Off by default; the engine is an optional dependency. */
  math: MathOption;
  /** Include chapters with `draft: true`. Defaults to `true` in development. */
  includeDrafts: boolean;
  /** Where compiled chapters are cached. */
  cacheDir: string;
}

export type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * One route and everything under it: a content folder, a `basePath` and the
 * agent plugins that serve it. Shelves are never nested (see the docs).
 */
export interface BookshelfConfig {
  /** Stable id, used by `ReaderRoot shelf="…"`, `getShelf("…")` and storage keys. */
  id: string;
  /** Where the shelf is mounted. Must start with "/"; "/" is allowed. */
  basePath: string;
  /** Shelf title (shelf `.md` H1, `llms.txt` H1, frontmatter). Defaults to "Books". */
  title?: string;
  /** Shelf summary (shelf `.md`, `llms.txt`, frontmatter). */
  description?: string;
  /** Merged over the top-level `content`. */
  content?: ReaderUserConfig["content"];
  /** Merged over the top-level `reader` (client options), minus `basePath`. */
  reader?: Omit<DeepPartial<ReaderClientOptions>, "basePath">;
  /** Plugins for this shelf; merged with the top-level `agent.plugins`. */
  agent?: { plugins?: AgentPlugin[] };
}

export interface ReaderUserConfig {
  content?: DeepPartial<Omit<ContentConfig, "schemas" | "loader">> & {
    loader?: GlobLoader;
    schemas?: Partial<ContentConfig["schemas"]>;
  };
  reader?: DeepPartial<ReaderClientOptions>;
  /** Agent plugins shared by every shelf. Server-only; never sent to the client. */
  agent?: { plugins?: AgentPlugin[] };
  /** One entry per route. Omit for a single, implicit shelf. */
  bookshelves?: BookshelfConfig[];
}

/** A fully resolved bookshelf: what every zreader surface reads. */
export interface ResolvedShelf {
  id: string;
  basePath: string;
  title: string;
  description?: string;
  content: ContentConfig;
  /** The shelf's `reader`, with `basePath` and `storagePrefix` filled in. */
  reader: ReaderClientOptions;
  plugins: AgentPlugin[];
}

export interface ResolvedReaderConfig {
  root: string;
  /** The default shelf's content config. */
  content: ContentConfig;
  /** The default shelf's client options. */
  reader: ReaderClientOptions;
  /** Never empty. The first entry is the default shelf. */
  shelves: ResolvedShelf[];
  /** Id of the first shelf. */
  defaultShelf: string;
}

// ------------------------------------------------------------- defaults

export const DEFAULT_SHELF_ID = "books";
export const DEFAULT_SHELF_TITLE = "Books";

export const defaultBookSchema = z.looseObject({
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()).default([]),
  description: z.string().optional(),
  cover: z.string().optional(),
  /** Optional explicit chapter order (chapter slugs). */
  chapters: z.array(z.string()).optional(),
});

export const defaultChapterSchema = z.looseObject({
  title: z.string(),
  order: z.number().optional(),
  description: z.string().optional(),
  part: z.string().optional(),
  label: z.string().optional(),
  number: z.union([z.string(), z.number()]).transform(String).optional(),
  draft: z.boolean().default(false),
});

function isDev() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

export const DEFAULT_ASSET_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] as const;

export function defaultImageOptions(): ImageOptions {
  return {
    allowRemote: true,
    allowDataUri: true,
    maxDataUriBytes: 8 * 1024 * 1024,
    warnDataUriTotalBytes: 2 * 1024 * 1024,
    allowSvgDataUri: false,
    probeRemote: false,
    probeTimeoutMs: 3000,
    lazy: true,
    lightbox: true,
    captions: true,
  };
}

export function defaultContentConfig(): ContentConfig {
  return {
    loader: glob({ base: "./content/books" }),
    schemas: { book: defaultBookSchema, chapter: defaultChapterSchema },
    remarkPlugins: [],
    rehypePlugins: [],
    sanitize: {},
    images: defaultImageOptions(),
    assets: { route: "_assets", extensions: [...DEFAULT_ASSET_EXTENSIONS] },
    math: false,
    includeDrafts: isDev(),
    cacheDir:
      (typeof process !== "undefined" && process.env?.ZREADER_CACHE_DIR) || "node_modules/.cache/zreader",
  };
}

// ------------------------------------------------------------ define/merge

/** Identity helper that gives `reader.config.ts` full type-checking. */
export function defineConfig(config: ReaderUserConfig): ReaderUserConfig {
  return config;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge: plain objects merge key-by-key, arrays and class instances
 * (e.g. zod schemas) replace, `undefined` never overrides.
 */
export function mergeConfig<T>(base: T, ...overrides: unknown[]): T {
  let out: unknown = base;
  for (const o of overrides) out = mergeTwo(out, o);
  return out as T;
}

function mergeTwo(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = mergeTwo(a[k], v);
    return out;
  }
  return b;
}

// --------------------------------------------------------------- plugins

function isPluginLike(v: unknown): v is AgentPlugin {
  return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
}

/**
 * Top-level plugins first, then the shelf's. A shelf plugin with the same `name`
 * replaces the inherited one *in place*, keeping its run order.
 */
export function mergePlugins(top: AgentPlugin[] = [], own: AgentPlugin[] = []): AgentPlugin[] {
  const out = top.slice();
  for (const p of own) {
    const at = out.findIndex((x) => x.name === p.name);
    // Replace an inherited plugin in place, keeping its position (and run order).
    // Duplicates *within* `own` are kept, so §2.3 can report them.
    if (at >= 0 && at < top.length) out[at] = p;
    else out.push(p);
  }
  return applyDisables(out);
}

/** `disable("name")` drops an inherited plugin; the marker itself never runs. */
export function applyDisables(plugins: AgentPlugin[]): AgentPlugin[] {
  const dropped = new Set(plugins.map((p) => p.disable).filter((n): n is string => typeof n === "string"));
  if (!dropped.size) return plugins;
  return plugins.filter((p) => !p.disable && !dropped.has(p.name));
}

// --------------------------------------------------------------- validate

const themeName = z.enum(THEMES);
const highlightColor = z.enum(HIGHLIGHT_COLORS);
const sandboxPlacement = z.union([z.literal("browser"), z.literal(false)], { error: 'use "browser" or false' });
const dangerousPermissions = z
  .object({
    network: z.union([z.literal(true), z.array(z.string().regex(/^https?:\/\/(\*\.)?[^/\s*;,']+\/?$/))], {
      error: "use true or a list of origins such as https://api.example.com",
    }),
    packages: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "use a package name such as numpy")),
  })
  .partial()
  .strict();
const clientSchema = z
  .object({
    storagePrefix: z.string().regex(/^[a-z0-9_-]+$/i, "use letters, digits, '-' or '_'"),
    highlightColors: z.array(highlightColor).min(1, "must be non-empty"),
    defaultHighlightColor: highlightColor,
    scratchpad: z.object({
      enabled: z.boolean(),
      scopes: z.array(z.enum(["global", "book", "chapter"])).min(1, "must be non-empty"),
    }),
    userImages: z.object({ enabled: z.boolean(), maxBytes: z.number().int().positive() }),
    offline: z.object({ enabled: z.boolean(), serviceWorker: z.string().startsWith("/") }),
    themes: z.array(themeName).min(1),
    defaultTheme: themeName,
    defaultSettings: z.object({
      textSize: z.enum(TEXT_SIZES),
      leading: z.enum(LEADINGS),
      measure: z.enum(MEASURES),
      fontFamily: z.enum(FONT_FAMILIES),
      highlightMode: z.boolean(),
    }),
    progress: z.object({ completeAt: z.number().gt(0).max(1), saveIntervalMs: z.number().min(100) }),
    backupReminder: z.boolean(),
    basePath: z.string().startsWith("/"),
    sandbox: z.object({
      scopes: z.object({ global: sandboxPlacement, book: sandboxPlacement, chapter: sandboxPlacement }),
      kernel: z.object({
        idleTimeoutMs: z.union([z.literal(false), z.number().int().min(0)], { error: "use milliseconds, or 0 or false for never" }),
        runTimeoutMs: z.union([z.literal(false), z.number().int().min(100)], { error: "use milliseconds (at least 100), or false for no limit" }),
      }),
      permissions: z.object({ scratchpad: z.object({ dangerousPermissions }) }),
    }),
  })
  .refine((c) => c.highlightColors.includes(c.defaultHighlightColor), {
    message: "defaultHighlightColor must be one of highlightColors",
    path: ["defaultHighlightColor"],
  })
  .refine((c) => c.themes.includes(c.defaultTheme), {
    message: "defaultTheme must be one of themes",
    path: ["defaultTheme"],
  });

function isSchemaLike(v: unknown): boolean {
  return typeof v === "object" && v !== null && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

const contentSchema = z.object({
  loader: z.object({
    kind: z.literal("glob"),
    base: z.string().min(1),
    pattern: z.union([z.string(), z.array(z.string()).min(1)]),
    ignore: z.array(z.string()).optional(),
  }),
  schemas: z.object({
    book: z.custom<z.ZodType>(isSchemaLike, "must be a zod (or safeParse-compatible) schema"),
    chapter: z.custom<z.ZodType>(isSchemaLike, "must be a zod (or safeParse-compatible) schema"),
  }),
  remarkPlugins: z.array(z.any()),
  rehypePlugins: z.array(z.any()),
  sanitize: z.object({
    allowIframes: z.array(z.string()).optional(),
    allowTags: z.array(z.string()).optional(),
    allowAttributes: z.array(z.string()).optional(),
    svg: z.boolean().optional(),
  }),
  images: z.object({
    allowRemote: z.union([z.boolean(), z.array(z.string().min(1))]),
    allowDataUri: z.boolean(),
    maxDataUriBytes: z.number().int().positive(),
    maxDataUriTotalBytes: z.number().int().positive().optional(),
    warnDataUriTotalBytes: z.number().int().positive(),
    allowSvgDataUri: z.boolean(),
    probeRemote: z.boolean(),
    probeTimeoutMs: z.number().int().positive(),
    lazy: z.boolean(),
    lightbox: z.boolean(),
    captions: z.boolean(),
  }),
  assets: z.object({
    route: z.string().regex(/^[a-z0-9_-]+$/i, "use letters, digits, '-' or '_'"),
    extensions: z.array(z.string().regex(/^[a-z0-9]+$/i, "no dots, e.g. \"png\"")).min(1),
  }),
  math: z.union([
    z.literal(false),
    z.enum(MATH_ENGINES),
    z.object({
      engine: z.enum(MATH_ENGINES),
      options: z.record(z.string(), z.unknown()).optional(),
      macros: z.record(z.string(), z.string()).optional(),
    }),
  ]),
  includeDrafts: z.boolean(),
  cacheDir: z.string(),
});

export class ReaderConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ReaderConfigError";
  }
}

function collect(error: z.ZodError, section: string, issues: { path: string; message: string }[]) {
  for (const i of error.issues) issues.push({ path: [section, ...i.path.map(String)].join("."), message: i.message });
}

// ---------------------------------------------------------------- shelves

/** Trailing slashes trimmed, `//` collapsed. `""` becomes `"/"`. */
export function normalizeBasePath(basePath: string): string {
  const n = basePath.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return n || "/";
}

/** True when `inner` is `outer` or lives under it. `"/"` contains everything. */
export function pathContains(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  if (outer === "/") return true;
  return inner.startsWith(`${outer}/`);
}

function resolveShelf(
  s: BookshelfConfig,
  topReader: ReaderClientOptions,
  topContent: ContentConfig,
  topPlugins: AgentPlugin[],
  isDefault: boolean,
): ResolvedShelf {
  const content = mergeConfig<ContentConfig>(topContent, s.content);
  const merged = mergeConfig<ReaderClientOptions>(topReader, s.reader);
  const explicitPrefix = s.reader?.storagePrefix != null;
  const reader: ReaderClientOptions = {
    ...merged,
    basePath: s.basePath,
    // The default shelf keeps the shared prefix so existing readers keep their data.
    storagePrefix: isDefault || explicitPrefix ? merged.storagePrefix : `${topReader.storagePrefix}-${s.id}`,
  };
  return {
    id: s.id,
    basePath: s.basePath,
    title: s.title ?? DEFAULT_SHELF_TITLE,
    description: s.description,
    content,
    reader,
    plugins: mergePlugins(topPlugins, s.agent?.plugins),
  };
}

function validateShelves(shelves: ResolvedShelf[], issues: { path: string; message: string }[]) {
  const fail = (path: string, message: string) => {
    if (!issues.some((i) => i.path === path && i.message === message)) issues.push({ path, message });
  };
  const byId = new Map<string, number>();
  const byPath = new Map<string, number>();
  const rootClaims = new Map<string, string>();

  shelves.forEach((s, i) => {
    const at = `bookshelves[${i}]`;
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(s.id)) fail(`${at}.id`, "use letters, digits, '-' or '_'");
    if (byId.has(s.id)) fail(`${at}.id`, `duplicate id "${s.id}"`);
    else byId.set(s.id, i);

    if (!s.basePath.startsWith("/")) fail(`${at}.basePath`, 'must start with "/"');
    const norm = normalizeBasePath(s.basePath);
    const owner = byPath.get(norm);
    if (owner != null) fail(`${at}.basePath`, `"${norm}" is already used by "${shelves[owner]!.id}"`);
    else byPath.set(norm, i);

    s.plugins.forEach((p, j) => {
      if (!isPluginLike(p)) fail(`${at}.agent.plugins[${j}]`, "not a zreader agent plugin");
    });
    const seen = new Set<string>();
    for (const p of s.plugins) {
      if (seen.has(p.name)) fail(`${at}.agent.plugins`, `two "${p.name}" plugins`);
      seen.add(p.name);
    }
    // A shelf mounted at "/" already serves these from its relative routes.
    if (norm !== "/") {
      for (const p of s.plugins) {
        for (const route of p.rootRoutes ?? []) {
          const ownerShelf = rootClaims.get(route.path);
          if (ownerShelf) fail(`${at}.agent.plugins`, `${route.path} is already claimed by "${ownerShelf}"`);
          else rootClaims.set(route.path, s.id);
        }
      }
    }
  });

  // Shelves cannot be nested (§2.3.1): one route each, so no longest-prefix rules.
  for (let j = 1; j < shelves.length; j++) {
    const inner = normalizeBasePath(shelves[j]!.basePath);
    for (let i = 0; i < j; i++) {
      const outer = normalizeBasePath(shelves[i]!.basePath);
      if (inner === outer) continue; // duplicate, already reported
      if (inner === "/") {
        fail(`bookshelves[${j}].basePath`, '"/" would contain every other bookshelf; bookshelves cannot be nested');
      } else if (outer === "/") {
        fail(`bookshelves[${i}].basePath`, '"/" would contain every other bookshelf; bookshelves cannot be nested');
      } else if (pathContains(outer, inner)) {
        fail(
          `bookshelves[${j}].basePath`,
          `"${shelves[j]!.basePath}" is inside "${outer}" (bookshelf "${shelves[i]!.id}"); bookshelves cannot be nested`,
        );
      } else if (pathContains(inner, outer)) {
        fail(
          `bookshelves[${i}].basePath`,
          `"${shelves[i]!.basePath}" is inside "${inner}" (bookshelf "${shelves[j]!.id}"); bookshelves cannot be nested`,
        );
      }
    }
  }
}

function warnMissingFolders(root: string, shelves: ResolvedShelf[]) {
  if (!isDev()) return;
  for (const s of shelves) {
    const base = s.content.loader.base;
    if (!existsSync(resolve(root, base))) console.warn(`[zreader] bookshelf "${s.id}": ${base} does not exist`);
  }
}

// ---------------------------------------------------------------- resolve

/**
 * Resolve the final config: package defaults ← reader.config.ts ← inline overrides.
 * Throws `ReaderConfigError` with readable messages.
 */
export function resolveConfig(
  user?: ReaderUserConfig | null,
  inline?: ReaderUserConfig | null,
  opts: { root?: string; source?: string } = {},
): ResolvedReaderConfig {
  const root = opts.root ?? (typeof process !== "undefined" && process.cwd ? process.cwd() : "/");
  const source = opts.source ?? "";
  const issues: { path: string; message: string }[] = [];

  const topReader = mergeConfig<ReaderClientOptions>(structuredClone(DEFAULT_CLIENT_OPTIONS), user?.reader, inline?.reader);
  const topContent = mergeConfig<ContentConfig>(defaultContentConfig(), user?.content, inline?.content);
  const topPlugins = [...(user?.agent?.plugins ?? []), ...(inline?.agent?.plugins ?? [])];
  const bookshelves = user?.bookshelves ?? inline?.bookshelves;

  let shelves: ResolvedShelf[];
  if (bookshelves?.length) {
    if (user?.reader?.basePath != null || inline?.reader?.basePath != null) {
      issues.push({ path: "reader.basePath", message: "set basePath on each bookshelf instead" });
    }
    shelves = bookshelves.map((s, i) => resolveShelf(s, topReader, topContent, topPlugins, i === 0));
    validateShelves(shelves, issues);
    shelves.forEach((s, i) => {
      const r = clientSchema.safeParse(s.reader);
      if (!r.success) collect(r.error, `bookshelves[${i}].reader`, issues);
      const c = contentSchema.safeParse(s.content);
      if (!c.success) collect(c.error, `bookshelves[${i}].content`, issues);
    });
  } else {
    // The implicit shelf: an existing reader.config.ts resolves to exactly one.
    const r = clientSchema.safeParse(topReader);
    if (!r.success) collect(r.error, "reader", issues);
    const c = contentSchema.safeParse(topContent);
    if (!c.success) collect(c.error, "content", issues);
    shelves = [
      {
        id: DEFAULT_SHELF_ID,
        basePath: topReader.basePath,
        title: DEFAULT_SHELF_TITLE,
        content: topContent,
        reader: topReader,
        plugins: mergePlugins(topPlugins),
      },
    ];
  }

  if (issues.length) {
    throw new ReaderConfigError(
      `Invalid reader config${source ? ` (${source})` : ""}:\n` + issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
      issues,
    );
  }

  warnMissingFolders(root, shelves);

  return {
    root,
    content: shelves[0]!.content,
    reader: shelves[0]!.reader,
    shelves,
    defaultShelf: shelves[0]!.id,
  };
}

/** Look a shelf up by id. The default shelf when `id` is omitted. */
export function shelfById(config: ResolvedReaderConfig, id?: string): ResolvedShelf | undefined {
  if (id == null || id === config.defaultShelf) return config.shelves[0];
  return config.shelves.find((s) => s.id === id);
}

/** The default shelf. `shelves` is never empty, so this cannot be undefined. */
export function defaultShelfOf(config: ResolvedReaderConfig): ResolvedShelf {
  return config.shelves[0]!;
}

/** Only the serializable, client-safe half of a shelf (defaults to the default shelf). */
export function clientOptions(config: ResolvedReaderConfig, shelfId?: string): ReaderClientOptions {
  return (shelfById(config, shelfId) ?? config.shelves[0])!.reader;
}

export const CONFIG_FILE_NAMES = ["reader.config.ts", "reader.config.mts", "reader.config.mjs", "reader.config.js"];
