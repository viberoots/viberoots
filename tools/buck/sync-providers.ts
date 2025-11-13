#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./providers/index.ts";
import { ensureGraph } from "./glue-run.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";

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

function flagBool(name: string): boolean {
  const a: any = (global as any).argv || {};
  if (a && (a[name] === true || String(a[name] || "").toLowerCase() === "true")) return true;
  const raw = process.argv;
  return raw.includes(`--${name}`);
}

function flagStr(name: string, def: string): string {
  const a: any = (global as any).argv || {};
  if (a && typeof a[name] === "string" && a[name]) return a[name] as string;
  const raw = process.argv;
  const idx = raw.indexOf(`--${name}`);
  if (idx >= 0 && raw[idx + 1]) return raw[idx + 1];
  return def;
}

function flagProvided(name: string): boolean {
  const raw: string[] = process.argv || [];
  const needle = `--${name}`;
  for (const arg of raw) {
    if (arg === needle) return true;
    if (arg.startsWith(needle + "=")) return true;
  }
  return false;
}

const OUT_FILE = flagStr("out", "third_party/providers/TARGETS.auto");
const STRICT = flagBool("strict");
const LANG = flagStr("lang", "");
const EMIT_INDEX = flagBool("emit-index") || flagBool("emitIndex");

async function main() {
  // Preserve Node default out path unless user explicitly provided --out
  const maybeOut = flagProvided("out") ? OUT_FILE : undefined;
  const targetLang = LANG || (flagProvided("out") ? "node" : "");
  if (targetLang === "cpp") {
    // Optional debug: show providers dir before running any steps
    try {
      const { stdout } = await $({
        stdio: "pipe",
      })`bash -lc 'ls -la third_party/providers 2>/dev/null || true'`;
      dbg("before (third_party/providers):\n" + String(stdout || "").trim());
    } catch {}
  }
  await syncAllProviders({ outFile: maybeOut as any, strict: STRICT, lang: targetLang });
  if (targetLgLangRequested(targetLang)) {
    // When a specific language is requested, also ensure downstream glue is present so
    // Buck macros that load //third_party/providers:auto_map.bzl can parse in temp repos.
    // Ensure graph.json exists before generating auto_map and provider index
    await ensureGraph();
    await $`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/gen-auto-map.ts --graph ${DEFAULT_GRAPH_PATH} --out ./third_party/providers/auto_map.bzl`;
    try {
      const { generateProviderIndex } = await import("./gen-provider-index.ts");
      await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
    } catch {}
    if (targetLang === "cpp") {
      try {
        const { stdout } = await $({
          stdio: "pipe",
        })`bash -lc 'ls -la third_party/providers 2>/dev/null || true'`;
        dbg("after (third_party/providers):\n" + String(stdout || "").trim());
      } catch {}
    }
  } else if (EMETIndexRequested()) {
    const { generateProviderIndex } = await import("./gen-provider-index.ts");
    await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
  }
}

function targetLgLangRequested(lang: string): boolean {
  return typeof lang === "string" && lang.length > 0;
}

function EMETIndexRequested(): boolean {
  return EMIT_INDEX;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
