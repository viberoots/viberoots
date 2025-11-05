#!/usr/bin/env zx-wrapper
import type { LanguageProviderSync } from "../../lib/lang-contracts";
import { syncCppProviders } from "./cpp.ts";
import { syncGoProviders } from "./go.ts";
import { syncNodeProviders } from "./node.ts";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
  patchDir?: string;
  lang?: string; // optional narrow
};

const handlers: LanguageProviderSync[] = [
  {
    lang: "cpp",
    sync: async (_opts) => syncCppProviders({ outFile: "third_party/providers/TARGETS.cpp.auto" }),
  },
  {
    lang: "go",
    sync: async (opts) =>
      syncGoProviders({
        outFile: "third_party/providers/TARGETS.go.auto",
        patchDir: opts?.patchDir,
        strict: opts?.strict,
      }),
  },
  {
    lang: "node",
    sync: async (opts) =>
      syncNodeProviders({
        outFile: opts?.outFile || "third_party/providers/TARGETS.node.auto",
        patchDir: opts?.patchDir,
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
