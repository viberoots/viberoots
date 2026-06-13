#!/usr/bin/env zx-wrapper
import { findImporterLockfiles } from "../../lib/importers";
import type { LanguageProviderSync } from "../../lib/lang-contracts";
import { detectEnabledLanguages } from "../../lib/langs";
import { ensureWorkspaceProvidersPackage } from "../../lib/workspace-providers-package";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
  patchDir?: string;
  lang?: string; // optional narrow
};

/**
 * Tiny provider driver registry: language id → async loader that returns
 * a LanguageProviderSync adapter.
 *
 * This reduces per-language conditional wiring and centralizes defaults.
 * Adding a new ecosystem is one registry entry.
 */
const REGISTRY: Record<string, () => Promise<LanguageProviderSync>> = {
  cpp: async () => ({
    lang: "cpp",
    sync: async () => {
      console.info("[providers] C++ provider sync is a no-op — see drop-cpp-provider.md.");
    },
  }),
  node: async () => {
    const { syncNodeProviders } = await import("./node");
    return {
      lang: "node",
      sync: async (opts) =>
        syncNodeProviders({
          outFile: opts?.outFile || providerAutoTargetsPath("node"),
          patchDir: opts?.patchDir,
        }),
    };
  },
  python: async () => {
    const { syncPythonProviders } = await import("./python");
    return {
      lang: "python",
      sync: async (opts) =>
        syncPythonProviders({
          outFile: opts?.outFile || providerAutoTargetsPath("python"),
          strict: opts?.strict,
        }),
    };
  },
  rust: async () => {
    try {
      const { syncRustProviders } = await import("./rust");
      return {
        lang: "rust",
        sync: async (opts) =>
          syncRustProviders({
            outFile: opts?.outFile || providerAutoTargetsPath("rust"),
            patchDir: opts?.patchDir || "patches/rust",
            strict: opts?.strict,
          }),
      };
    } catch {
      // In sparse clones without rust.ts, return a no-op that does nothing.
      return {
        lang: "rust",
        sync: async () => {},
      };
    }
  },
};

export async function buildHandlers(narrow?: string): Promise<LanguageProviderSync[]> {
  // Discover enabled languages from the manifest; partial-clone safe.
  const enabled = new Set((await detectEnabledLanguages(process.cwd())).map((l) => l.id));
  // Node fallback PNPM detection (safety net for ultra-thin slices)
  try {
    if (!enabled.has("node")) {
      const pnpm = await findImporterLockfiles(["pnpm-lock.yaml"]);
      if (pnpm.length > 0) enabled.add("node");
    }
  } catch {
    // best-effort; leave set unchanged
  }
  // Selection:
  // - If --lang was passed, honor it strictly.
  // - Otherwise, include Node and Python by default (stable header-only files when no lockfiles),
  //   and union with any additionally detected languages.
  const defaults = new Set<string>(["node", "python"]);
  const base = narrow ? new Set<string>([narrow]) : new Set<string>([...defaults, ...enabled]);
  const want = Array.from(base).filter((id) => id && REGISTRY[id]);

  const out: LanguageProviderSync[] = [];
  for (const id of want) {
    // Each registry entry returns an adapter with stable defaults per language
    const adapter = await REGISTRY[id]();
    // Skip rust adapter if the module is missing and loader returned a no-op without sync
    if (typeof adapter?.sync === "function") out.push(adapter);
  }
  return out;
}

export async function syncAllProviders(opts?: SyncOptions) {
  await ensureWorkspaceProvidersPackage();
  const handlers = await buildHandlers(opts?.lang);
  for (const h of handlers) {
    await h.sync({ outFile: opts?.outFile, patchDir: opts?.patchDir, strict: opts?.strict });
  }
}
