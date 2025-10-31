#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { writeIfChanged } from "../lib/fs-helpers";
import { syncAllProviders } from "./providers/index.ts";

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

const OUT_FILE = flagStr("out", "third_party/providers/TARGETS.auto");
const STRICT = flagBool("strict");
const LANG = flagStr("lang", "");
const EMIT_INDEX = flagBool("emit-index") || flagBool("emitIndex");

async function main() {
  await syncAllProviders({ outFile: OUT_FILE, strict: STRICT, lang: LANG });
  // Guard: ensure the Node providers file exists even when there are no lockfiles/patches.
  // Some callers (and tests) expect a minimal header-only TARGETS.node.auto to be
  // present after a sync. If it doesn't exist yet, write the canonical header.
  try {
    await fsp.access(OUT_FILE);
  } catch {
    const header = [
      "# GENERATED FILE — DO NOT EDIT.",
      `# Node importer-scoped providers derived from pnpm-lock.yaml`,
      "",
      'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      "",
      "",
    ].join("\n");
    await writeIfChanged(OUT_FILE, header);
  }
  if (EMIT_INDEX) {
    const { generateProviderIndex } = await import("./gen-provider-index.ts");
    await generateProviderIndex({ outFile: "third_party/providers/provider_index.bzl" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
