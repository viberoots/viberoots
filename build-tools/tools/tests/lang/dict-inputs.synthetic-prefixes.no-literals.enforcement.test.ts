#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const PREFIX_LITERALS = [
  /__patch_inputs__/g,
  /__provider_edges__/g,
  /__global_nix_inputs__/g,
] as const;

async function listBzlFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listBzlFilesUnder(p)));
      continue;
    }
    if (e.isFile() && e.name.endsWith(".bzl")) {
      out.push(p);
    }
  }
  return out;
}

test("Starlark does not hardcode dict-safe synthetic prefix literals outside build-tools/lang/dict_inputs.bzl", async () => {
  const repoRoot = process.cwd();
  const allowlist = new Set([path.join(repoRoot, "lang", "dict_inputs.bzl")]);
  const roots = ["lang", "go", "node", "python", "cpp"].map((d) => path.join(repoRoot, d));

  const files = (await Promise.all(roots.map((r) => listBzlFilesUnder(r))))
    .flat()
    .filter((f) => !allowlist.has(f))
    .sort();

  const offenders: Array<{ file: string; matches: string[] }> = [];
  for (const f of files) {
    const txt = await fsp.readFile(f, "utf8").catch(() => "");
    const matches = PREFIX_LITERALS.flatMap((re) => txt.match(re) || []);
    if (matches.length > 0)
      offenders.push({ file: f, matches: Array.from(new Set(matches)).sort() });
  }

  if (offenders.length > 0) {
    console.error("found dict-safe synthetic prefix literals in *.bzl files:");
    console.error(
      "expected callers to import PATCH_INPUTS_KEY_PREFIX/PROVIDER_EDGES_KEY_PREFIX/GLOBAL_NIX_INPUTS_KEY_PREFIX via //build-tools/lang:defs_common.bzl",
    );
    for (const o of offenders) {
      console.error(`- ${o.file}: ${o.matches.join(", ")}`);
    }
    process.exit(2);
  }
});
