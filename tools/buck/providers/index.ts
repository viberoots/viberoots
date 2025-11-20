#!/usr/bin/env zx-wrapper
import type { LanguageProviderSync } from "../../lib/lang-contracts";
import { syncNodeProviders } from "./node.ts";
import { syncPythonProviders } from "./python.ts";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
  patchDir?: string;
  lang?: string; // optional narrow
};

const handlers: LanguageProviderSync[] = [
  {
    lang: "cpp",
    sync: async (_opts) => {
      console.info(
        "[providers] C++ provider sync is now a no-op — see drop-cpp-provider.md (PR 2).",
      );
      return;
    },
  },
  {
    lang: "node",
    sync: async (opts) =>
      syncNodeProviders({
        outFile: opts?.outFile || "third_party/providers/TARGETS.node.auto",
        patchDir: opts?.patchDir,
      }),
  },
  {
    lang: "python",
    sync: async (opts) =>
      syncPythonProviders({
        outFile: opts?.outFile || "third_party/providers/TARGETS.python.auto",
        patchDir: opts?.patchDir || "patches/python",
        strict: opts?.strict,
      }),
  },
];

export async function syncAllProviders(opts?: SyncOptions) {
  const targetLang = opts?.lang;
  for (const h of handlers) {
    if (!targetLang || targetLang === h.lang) {
      await h.sync({ outFile: opts?.outFile, patchDir: opts?.patchDir, strict: opts?.strict });
    }
  }
}
