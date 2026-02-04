#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const DEV_OVERRIDE_ENV_LITERAL = /NIX_[A-Z_]+_DEV_OVERRIDE_JSON/g;

async function listNixFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listNixFilesUnder(p)));
    } else if (e.isFile() && e.name.endsWith(".nix")) {
      out.push(p);
    }
  }
  return out;
}

test("nix templates do not hardcode NIX_*_DEV_OVERRIDE_JSON literals", async () => {
  const root = path.join(process.cwd(), "build-tools", "tools", "nix", "templates");
  const files = (await listNixFilesUnder(root)).sort();
  const offenders: Array<{ file: string; matches: string[] }> = [];
  for (const f of files) {
    const txt = await fsp.readFile(f, "utf8").catch(() => "");
    const matches = txt.match(DEV_OVERRIDE_ENV_LITERAL) || [];
    if (matches.length > 0)
      offenders.push({ file: f, matches: Array.from(new Set(matches)).sort() });
  }
  if (offenders.length > 0) {
    console.error("found dev override env literals in build-tools/tools/nix/templates/**:");
    for (const o of offenders) {
      console.error(`- ${o.file}: ${o.matches.join(", ")}`);
    }
    process.exit(2);
  }
});
