#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readGraph } from "../../lib/graph.ts";
import { validateFlatDir } from "../../lib/provider-sync.ts";
import {
  encodeNixAttrForPatchPrefix,
  normalizeNixAttr,
  providerNameForNixAttr,
} from "../../lib/providers.ts";

type Node = { name: string; labels?: string[] };

// Normalization and naming are shared across generators.
const normalizeAttr = normalizeNixAttr;
const nameForAttr = providerNameForNixAttr;

async function listCppPatchesFor(attr: string): Promise<string[]> {
  const dir = "patches/cpp";
  const out: string[] = [];
  try {
    await fsp.access(dir);
  } catch {
    return out;
  }
  // Validate directory flatness once per call site; warn by default
  await validateFlatDir(dir, false).catch(() => {});
  const enc = encodeNixAttrForPatchPrefix(attr);
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".patch")) continue;
    if (!f.startsWith(`${enc}@`)) continue;
    out.push(path.join(dir, f));
  }
  out.sort();
  return out;
}

async function readCuratedProviders(): Promise<Array<{ name: string; attr: string }>> {
  const TARGETS = path.resolve("third_party/providers/TARGETS");
  try {
    const txt = await fsp.readFile(TARGETS, "utf8");
    const out: Array<{ name: string; attr: string }> = [];
    // Match nix_cxx_library(name = "...", attr = "...") allowing whitespace
    const re = /nix_cxx_library\(\s*name\s*=\s*"([^"]+)",\s*attr\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const name = m[1];
      const rawAttr = m[2];
      out.push({ name, attr: normalizeAttr(rawAttr) });
    }
    return out;
  } catch {
    return [];
  }
}

export async function syncCppProviders(_opts?: { outFile?: string }) {
  console.info("[providers] C++ provider sync is now a no-op — see drop-cpp-provider.md (PR 2).");
  return;
}
