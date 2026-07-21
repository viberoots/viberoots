#!/usr/bin/env zx-wrapper
import path from "node:path";
import { syncAllProviders } from "./providers/index";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import { runGluePipeline } from "./glue-pipeline";
import { DEFAULT_AUTO_MAP_PATH, providerAutoTargetsPath } from "../lib/workspace-state-paths";

function dbgEnabled(): boolean {
  try {
    return String(process.env.SYNC_PROVIDERS_DEBUG || "").trim() === "1";
  } catch {
    return false;
  }
}
function dbg(...args: any[]) {
  if (!dbgEnabled()) return;
  try {
    console.error("[sync-providers][debug]", ...args);
  } catch {}
}

// Preserve presence detection behavior for defaults that depend on explicit flags
const flagProvided = hasFlag;

const OUT_FILE = getFlagStr("out", providerAutoTargetsPath("node"));
const STRICT = getFlagBool("strict");
const LANG = getFlagStr("lang", "");
const EMIT_INDEX = getFlagBool("emit-index") || getFlagBool("emitIndex");
const NO_GLUE = getFlagBool("no-glue") || getFlagBool("noGlue");

async function main() {
  // Preserve Node default out path unless user explicitly provided --out
  const maybeOut = flagProvided("out") ? OUT_FILE : undefined;
  const targetLang = LANG || (flagProvided("out") ? "node" : "");
  if (targetLang === "cpp") {
    // Optional debug: show providers dir before running any steps
    try {
      const { stdout } = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -c 'ls -la .viberoots/workspace/providers 2>/dev/null || true'`;
      dbg("before (workspace providers):\n" + String(stdout || "").trim());
    } catch {}
  }
  await syncAllProviders({ outFile: maybeOut as any, strict: STRICT, lang: targetLang });
  if (targetLangRequested(targetLang) && !NO_GLUE) {
    // When a specific language is requested, also ensure downstream glue is present so
    // Buck macros load provider mappings via @workspace_providers//:auto_map.bzl.
    //
    // Delegate to the centralized glue pipeline for the shared post-sync steps
    // (graph reconciliation → optional provider_index → auto_map).
    await runGluePipeline({
      skipProviderSync: true,
      graphPath: DEFAULT_GRAPH_PATH,
      outAutoMap: DEFAULT_AUTO_MAP_PATH,
      providerIndex: emitIndexRequested() ? "required" : "best-effort",
      autoMap: "required",
    });
    if (targetLang === "cpp") {
      try {
        const { stdout } = await $({
          stdio: "pipe",
        })`bash --noprofile --norc -c 'ls -la .viberoots/workspace/providers 2>/dev/null || true'`;
        dbg("after (workspace providers):\n" + String(stdout || "").trim());
      } catch {}
    }
  } else if (emitIndexRequested() && !NO_GLUE) {
    // Preserve the existing CLI: allow emitting provider_index without running auto_map.
    await runGluePipeline({
      skipProviderSync: true,
      providerIndex: "required",
      autoMap: "skip",
    });
  }
}

export function targetLangRequested(lang: string): boolean {
  return typeof lang === "string" && lang.length > 0;
}

export function emitIndexRequested(): boolean {
  return EMIT_INDEX;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
