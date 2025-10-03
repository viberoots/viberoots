#!/usr/bin/env zx-wrapper
import type { LanguageProviderSync } from "../../lib/lang-contracts";
import { syncGoProviders } from "./go";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
  patchDir?: string;
  lang?: string; // optional narrow
};

const handlers: LanguageProviderSync[] = [{ lang: "go", sync: syncGoProviders }];

export async function syncAllProviders(opts?: SyncOptions) {
  const targetLang = opts?.lang;
  for (const h of handlers) {
    if (!targetLang || targetLang === h.lang) {
      await h.sync({ outFile: opts?.outFile, patchDir: opts?.patchDir, strict: opts?.strict });
    }
  }
}
