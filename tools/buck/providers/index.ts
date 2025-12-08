#!/usr/bin/env zx-wrapper
import { findImporterLockfiles } from "../../lib/importers.ts";
import type { LanguageProviderSync } from "../../lib/lang-contracts";
import { detectEnabledLanguages } from "../../lib/langs";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
  patchDir?: string;
  lang?: string; // optional narrow
};

async function buildHandlers(narrow?: string): Promise<LanguageProviderSync[]> {
  // Discover enabled languages from the manifest; partial-clone safe.
  const enabled = new Set((await detectEnabledLanguages(process.cwd())).map((l) => l.id));
  // Handle globbed requiredPaths (e.g., Node's **/pnpm-lock.yaml) by probing lockfile presence.
  try {
    if (!enabled.has("node")) {
      const pnpm = await findImporterLockfiles(["pnpm-lock.yaml"]);
      if (pnpm.length > 0) enabled.add("node");
    }
  } catch {
    // best-effort; leave set unchanged
  }
  // PR-1: Activate Python in sparse/partial clones when uv.lock is present.
  // Mirrors Node's PNPM detection logic using shared importer utilities.
  try {
    if (!enabled.has("python")) {
      const uv = await findImporterLockfiles(["uv.lock"]);
      if (uv.length > 0) enabled.add("python");
    }
  } catch {
    // best-effort; leave set unchanged
  }
  const want = narrow ? new Set([narrow]) : enabled;

  const out: LanguageProviderSync[] = [];

  // C++ — no-op provider sync (documented behavior)
  if (want.has("cpp")) {
    out.push({
      lang: "cpp",
      sync: async () => {
        console.info("[providers] C++ provider sync is a no-op — see drop-cpp-provider.md (PR 2).");
      },
    });
  }

  // Node — importer-scoped providers (only when language is present)
  if (want.has("node")) {
    const { syncNodeProviders } = await import("./node.ts");
    out.push({
      lang: "node",
      sync: async (opts) =>
        syncNodeProviders({
          outFile: opts?.outFile || "third_party/providers/TARGETS.node.auto",
          patchDir: opts?.patchDir,
        }),
    });
  }

  // Python — importer-scoped providers (uv.lock)
  if (want.has("python")) {
    const { syncPythonProviders } = await import("./python.ts");
    out.push({
      lang: "python",
      sync: async (opts) =>
        syncPythonProviders({
          outFile: opts?.outFile || "third_party/providers/TARGETS.python.auto",
          patchDir: opts?.patchDir || "patches/python",
          strict: opts?.strict,
        }),
    });
  }

  // Rust — placeholder sync (stubbed provider writer)
  if (want.has("rust")) {
    try {
      const { syncRustProviders } = await import("./rust.ts");
      out.push({
        lang: "rust",
        sync: async (opts) =>
          syncRustProviders({
            outFile: opts?.outFile || "third_party/providers/TARGETS.rust.auto",
            patchDir: opts?.patchDir || "patches/rust",
            strict: opts?.strict,
          }),
      });
    } catch {
      // If rust provider module is absent in a partial clone, skip gracefully.
    }
  }

  return out;
}

export async function syncAllProviders(opts?: SyncOptions) {
  const handlers = await buildHandlers(opts?.lang);
  for (const h of handlers) {
    await h.sync({ outFile: opts?.outFile, patchDir: opts?.patchDir, strict: opts?.strict });
  }
}
