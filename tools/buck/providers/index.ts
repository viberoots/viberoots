#!/usr/bin/env zx-wrapper
import { syncGoProviders } from "./go";

export type SyncOptions = {
  outFile?: string;
  strict?: boolean;
};

export async function syncAllProviders(opts?: SyncOptions) {
  // Go providers (always supported in current repo)
  await syncGoProviders({ outFile: opts?.outFile, strict: opts?.strict });
}
