/**
 * Next.js integration.
 *
 *   // next.config.ts
 *   import { withReader } from "zreader/next";
 *   export default withReader({ reactStrictMode: true });
 */
import { join, relative, resolve, sep } from "node:path";
import type { NextConfig } from "next";
import { resolveConfig, type ResolvedReaderConfig, type ReaderUserConfig } from "../config/index";
import { findConfigFile, loadConfigFile } from "../config/load";

export const USER_CONFIG_SPECIFIER = "zreader/user-config";
export const EMPTY_CONFIG_SPECIFIER = "zreader/empty-config";

/** Packages that must stay external on the server (dynamic requires / native-ish). */
export const SERVER_EXTERNALS = ["jsdom", "isomorphic-dompurify", "@mathjax/src"];

export interface WithReaderOptions {
  /** Path to the config file. Defaults to discovering reader.config.{ts,mts,mjs,js}. */
  configPath?: string;
  /** Project root. Defaults to process.cwd() (the directory containing next.config). */
  root?: string;
  /** Inline overrides merged on top of reader.config.ts. */
  config?: ReaderUserConfig;
  /** Log the resolved config file path at startup. */
  verbose?: boolean;
}

type NextConfigFn = (phase: string, ctx: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>;
export type NextConfigInput = NextConfig | NextConfigFn;

type WebpackFn = NonNullable<NextConfig["webpack"]>;

function toPosix(p: string) {
  return p.split(sep).join("/");
}

/** Alias target relative to the project root, as Turbopack expects (`./reader.config.ts`). */
function relativeImport(root: string, file: string) {
  const rel = toPosix(relative(root, file));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export interface ReaderNextSetup {
  configFile: string | null;
  resolved: ResolvedReaderConfig;
}

/** Pure transform (exported for testing): apply reader wiring to a resolved Next config. */
export function applyReaderConfig(base: NextConfig, setup: ReaderNextSetup, root: string): NextConfig {
  const { configFile, resolved } = setup;
  const turboTarget = configFile ? relativeImport(root, configFile) : EMPTY_CONFIG_SPECIFIER;
  const webpackTarget = configFile ?? EMPTY_CONFIG_SPECIFIER;

  const prevWebpack = base.webpack as WebpackFn | undefined;
  const webpack: WebpackFn = (config, ctx) => {
    const cfg = (prevWebpack ? prevWebpack(config, ctx) : config) as { resolve?: { alias?: Record<string, unknown> } };
    cfg.resolve ??= {};
    const alias = (cfg.resolve.alias ??= {}) as Record<string, unknown>;
    alias[`${USER_CONFIG_SPECIFIER}$`] = webpackTarget;
    return cfg;
  };

  // Every shelf's content folder, not just the default one (§2.7).
  const contentGlobs = Array.from(
    new Set(resolved.shelves.map((s) => toPosix(join(s.content.loader.base, "**/*")))),
  );
  const tracing = { ...(base.outputFileTracingIncludes ?? {}) };
  const allRoutes = "/**";
  tracing[allRoutes] = Array.from(new Set([...(tracing[allRoutes] ?? []), ...contentGlobs]));
  // The proxy/middleware entry is named "proxy" or "middleware" (no leading
  // slash, so "/**" misses it); zreader/agent reads chapters from the proxy.
  for (const entry of ["middleware", "proxy"]) {
    tracing[entry] = Array.from(new Set([...(tracing[entry] ?? []), ...contentGlobs]));
  }

  const externals = Array.from(new Set([...(base.serverExternalPackages ?? []), ...SERVER_EXTERNALS]));

  return {
    ...base,
    images: readerImagesConfig(base.images, resolved),
    serverExternalPackages: externals,
    outputFileTracingIncludes: tracing,
    turbopack: {
      ...base.turbopack,
      resolveAlias: {
        ...base.turbopack?.resolveAlias,
        [USER_CONFIG_SPECIFIER]: turboTarget,
      },
    },
    webpack,
  };
}

type NextImagesConfig = NonNullable<NextConfig["images"]>;
type RemotePattern = Exclude<NonNullable<NextImagesConfig["remotePatterns"]>[number], URL>;

/**
 * Hosts in `content.images.allowRemote` (when it is a list) become
 * `images.remotePatterns`, so next/image can optimize them. `allowRemote: true`
 * adds nothing: those images render `unoptimized` rather than turning the image
 * optimizer into an open proxy.
 */
export function readerImagesConfig(base: NextConfig["images"], resolved: ResolvedReaderConfig): NextConfig["images"] {
  const hosts = new Set<string>();
  for (const s of resolved.shelves) {
    const allow = s.content.images.allowRemote;
    if (Array.isArray(allow)) for (const h of allow) hosts.add(h.toLowerCase().replace(/^\*\./, ""));
  }
  // With no localPatterns every local path is allowed; once the app lists some,
  // book assets must be listed too.
  let localPatterns = base?.localPatterns;
  if (localPatterns) {
    const add = resolved.shelves.map((s) => ({ pathname: `${s.basePath.replace(/\/+$/, "")}/*/${s.content.assets.route}/**` }));
    localPatterns = [...localPatterns, ...add.filter((a) => !localPatterns!.some((p) => p.pathname === a.pathname))];
  }
  if (!hosts.size) return localPatterns ? { ...base, localPatterns } : base;
  const existing = base?.remotePatterns ?? [];
  const added: RemotePattern[] = [];
  const has = (p: RemotePattern) =>
    [...existing, ...added].some((e) => !(e instanceof URL) && e.hostname === p.hostname && e.protocol === p.protocol && !e.pathname);
  for (const h of hosts) {
    for (const protocol of ["https", "http"] as const) {
      for (const hostname of [h, `**.${h}`]) {
        const p: RemotePattern = { protocol, hostname };
        if (!has(p)) added.push(p);
      }
    }
  }
  return { ...base, ...(localPatterns ? { localPatterns } : {}), remotePatterns: [...existing, ...added] };
}

export async function setupReader(options: WithReaderOptions = {}): Promise<ReaderNextSetup> {
  const root = resolve(options.root ?? process.cwd());
  const configFile = options.configPath ? resolve(root, options.configPath) : findConfigFile(root);
  const user = configFile ? await loadConfigFile(configFile) : {};
  // Validate eagerly so `next dev` / `next build` fail fast with a readable error.
  const resolved = resolveConfig(user, options.config, {
    root,
    source: configFile ? relative(root, configFile) : "defaults",
  });
  return { configFile, resolved };
}

/**
 * Wire zreader into Next.js:
 * - validates reader.config.* at startup;
 * - aliases `zreader/user-config` to it (Turbopack + webpack), so
 *   `zreader/virtual-config` is the resolved config everywhere on the server;
 * - keeps jsdom/DOMPurify external on the server;
 * - traces the content directory into the server output (Vercel);
 * - points the compiled-chapter cache at `.next/cache/zreader`.
 */
export function withReader(nextConfig: NextConfigInput = {}, options: WithReaderOptions = {}): NextConfigFn {
  return async (phase, ctx) => {
    const root = resolve(options.root ?? process.cwd());
    process.env.ZREADER_CACHE_DIR ??= join(root, ".next", "cache", "zreader");
    const base = typeof nextConfig === "function" ? await nextConfig(phase, ctx) : nextConfig;
    const setup = await setupReader({ ...options, root });
    if (options.verbose) {
      console.log(`[zreader] config: ${setup.configFile ?? "(defaults)"}`);
    }
    return applyReaderConfig(base, setup, root);
  };
}

export { resolveConfig, findConfigFile, loadConfigFile };
export type { ResolvedReaderConfig, ReaderUserConfig };
