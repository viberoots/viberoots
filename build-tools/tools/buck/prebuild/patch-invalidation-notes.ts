#!/usr/bin/env zx-wrapper
import { patchInvalidationStrategyForLang } from "../../lib/lang-contracts.ts";

async function gitLsFiles(glob: string): Promise<string[]> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`git ls-files ${glob}`.nothrow();
    return String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function maybePrintPatchInvalidationNotes(): Promise<void> {
  try {
    const pnpmLocks = await gitLsFiles("**/pnpm-lock.yaml");
    const uvLocks = await gitLsFiles("**/uv.lock");
    const goPatches = await gitLsFiles("**/patches/go/*.patch");
    const cppPatches = await gitLsFiles("**/patches/cpp/*.patch");

    const importerLocalDetected = pnpmLocks.length > 0 || uvLocks.length > 0;
    if (pnpmLocks.length > 0) {
      const s = patchInvalidationStrategyForLang("node");
      if (s) {
        console.warn(
          `[prebuild] node patch_scope:${s.patchScope} — patch invalidation is driven by macro action inputs under <importer>/patches/node`,
        );
      }
    }
    if (uvLocks.length > 0) {
      const s = patchInvalidationStrategyForLang("python");
      if (s) {
        console.warn(
          `[prebuild] python patch_scope:${s.patchScope} — patch invalidation is driven by macro action inputs under <importer>/patches/python`,
        );
      }
    }
    if (importerLocalDetected) {
      console.warn(
        "[prebuild] importer-local patches: see build-tools/tools/buck/invalidation-report.txt for per-target action inputs",
      );
    }
    if (goPatches.length > 0) {
      const s = patchInvalidationStrategyForLang("go");
      if (s) {
        console.warn(
          `[prebuild] go patch_scope:${s.patchScope} — patch invalidation is driven by <pkg>/patches/go included as action inputs`,
        );
      }
    }
    if (cppPatches.length > 0) {
      const s = patchInvalidationStrategyForLang("cpp");
      if (s) {
        console.warn(
          `[prebuild] cpp patch_scope:${s.patchScope} — patch invalidation is driven by <pkg>/patches/cpp included as action inputs`,
        );
      }
    }
  } catch {
    // best-effort; keep guard robust in ultra-thin temp repos
  }
}
