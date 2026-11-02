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
}

export interface ContentConfig {
  loader: GlobLoader;
  schemas: { book: z.ZodType; chapter: z.ZodType };
  /** Applied to `.md` and `.mdx`. */
  remarkPlugins: PluginList;
  rehypePlugins: PluginList;
  sanitize: SanitizeOptions;
  /** Include chapters with `draft: true`. Defaults to `true` in development. */
  includeDrafts: boolean;
  /** Where compiled chapters are cached. */
  cacheDir: string;
}

type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export interface ReaderUserConfig {
  content?: DeepPartial<Omit<ContentConfig, "schemas" | "loader">> & {
    loader?: GlobLoader;
    schemas?: Partial<ContentConfig["schemas"]>;
  };
  reader?: DeepPartial<ReaderClientOptions>;
}

export interface ResolvedReaderConfig {
  root: string;
  content: ContentConfig;
  reader: ReaderClientOptions;
}

// ------------------------------------------------------------- defaults

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

export function defaultContentConfig(): ContentConfig {
  return {
    loader: glob({ base: "./content/books" }),
    schemas: { book: defaultBookSchema, chapter: defaultChapterSchema },
    remarkPlugins: [],
    rehypePlugins: [],
    sanitize: {},
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

// --------------------------------------------------------------- validate

const themeName = z.enum(THEMES);
const highlightColor = z.enum(HIGHLIGHT_COLORS);
const clientSchema = z
  .object({
    storagePrefix: z.string().regex(/^[a-z0-9_-]+$/i, "use letters, digits, '-' or '_'"),
    highlightColors: z.array(highlightColor).min(1, "must be non-empty"),
    defaultHighlightColor: highlightColor,
    scratchpad: z.object({
      enabled: z.boolean(),
      scopes: z.array(z.enum(["global", "book", "chapter"])).min(1, "must be non-empty"),
    }),
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
  }),
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

function formatIssues(source: string, section: string, error: z.ZodError) {
  const issues = error.issues.map((i) => ({ path: [section, ...i.path.map(String)].join("."), message: i.message }));
  return new ReaderConfigError(
    `Invalid reader config${source ? ` (${source})` : ""}:\n` + issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    issues,
  );
}

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
  const reader = mergeConfig<ReaderClientOptions>(
    structuredClone(DEFAULT_CLIENT_OPTIONS),
    user?.reader,
    inline?.reader,
  );
  const content = mergeConfig<ContentConfig>(defaultContentConfig(), user?.content, inline?.content);

  const r = clientSchema.safeParse(reader);
  if (!r.success) throw formatIssues(opts.source ?? "", "reader", r.error);
  const c = contentSchema.safeParse(content);
  if (!c.success) throw formatIssues(opts.source ?? "", "content", c.error);

  return { root, content, reader };
}

/** Only the serializable, client-safe half. */
export function clientOptions(config: ResolvedReaderConfig): ReaderClientOptions {
  return config.reader;
}

export const CONFIG_FILE_NAMES = ["reader.config.ts", "reader.config.mts", "reader.config.mjs", "reader.config.js"];
