#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./providers/index.ts";
import { ensureGraph } from "./glue-run.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";

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

const OUT_FILE = getFlagStr("out", "third_party/providers/TARGETS.auto");
const STRICT = getFlagBool("strict");
const LANG = getFlagStr("lang", "");
const EMIT_INDEX = getFlagBool("emit-index") || getFlagBool("emitIndex");

async function main() {
  // Preserve Node default out path unless user explicitly provided --out
  const maybeOut = flagProvided("out") ? OUT_FILE : undefined;
  const targetLang = LANG || (flagProvided("out") ? "node" : "");
  if (targetLang === "cpp") {
    // Optional debug: show providers dir before running any steps
    try {
      const { stdout } = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -c 'ls -la third_party/providers 2>/dev/null || true'`;
      dbg("before (third_party/providers):\n" + String(stdout || "").trim());
    } catch {}
  }
  await syncAllProviders({ outFile: maybeOut as any, strict: STRICT, lang: targetLang });
  if (targetLangRequested(targetLang)) {
    // When a specific language is requested, also ensure downstream glue is present so
    // Buck macros that load //third_party/providers:auto_map.bzl can parse in temp repos.
    // Ensure graph.json exists before generating auto_map and provider index
    await ensureGraph();
    await $`node --disable-warning=ExperimentalWarning --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/gen-auto-map.ts --graph ${DEFAULT_GRAPH_PATH} --out ./third_party/providers/auto_map.bzl`;
    try {
      const { generateProviderIndex } = await import("./gen-provider-index.ts");
      await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
    } catch {}
    if (targetLang === "cpp") {
      try {
        const { stdout } = await $({
          stdio: "pipe",
        })`bash --noprofile --norc -c 'ls -la third_party/providers 2>/dev/null || true'`;
        dbg("after (third_party/providers):\n" + String(stdout || "").trim());
      } catch {}
    }
  } else if (emitIndexRequested()) {
    const { generateProviderIndex } = await import("./gen-provider-index.ts");
    await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
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
