#!/usr/bin/env zx-wrapper
import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "../lib/repo.ts";

type Capabilities = Record<string, boolean>;
type Lang = {
  id: string;
  capabilities?: Capabilities;
};
type Manifest =
  | Lang[]
  | {
      languages?: Lang[];
    };

async function readManifest(repo: string): Promise<Lang[]> {
  const p = path.join(repo, "build-tools/tools/nix/langs.json");
  try {
    const txt = await fsp.readFile(p, "utf8");
    const doc = JSON.parse(txt) as Manifest;
    const list: Lang[] = Array.isArray(doc) ? (doc as Lang[]) : doc.languages || [];
    return (list || []).filter((l) => l && typeof l.id === "string");
  } catch {
    return [];
  }
}

function toNixBoolean(v: boolean): "true" | "false" {
  return v ? "true" : "false";
}

async function main() {
  const repo = await findRepoRoot(process.cwd());
  const langs = (await readManifest(repo)).slice().sort((a, b) => a.id.localeCompare(b.id));
  const header = [
    "# build-tools/tools/nix/langs.nix — GENERATED FILE — DO NOT EDIT.",
    "# Exposes a simple attribute set mapping language id -> capability flags.",
  ].join("\n");
  const body = langs
    .map((l) => {
      const caps = l.capabilities || {};
      const keys = Object.keys(caps).sort();
      const capLines = keys.map((k) => `    ${k} = ${toNixBoolean(Boolean(caps[k]))};`).join("\n");
      return `  ${l.id} = {\n${capLines}\n  };`;
    })
    .join("\n");
  const out = [header, "{", body, "}", ""].join("\n");
  const outPath = path.join(repo, "build-tools/tools/nix/langs.nix");
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  try {
    const cur = await fsp.readFile(outPath, "utf8");
    if (cur === out) {
      console.log("wrote", path.relative(repo, outPath), "(unchanged)");
      return;
    }
  } catch {}
  await fsp.writeFile(outPath, out, "utf8");
  console.log("wrote", path.relative(repo, outPath));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
