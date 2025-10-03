#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

export type LangId = string;
export type LangSpec = {
  id: LangId;
  displayName: string;
  requiredPaths: string[];
  optionalPaths?: string[];
  kinds: string[];
  templatesDir: string;
};

const KNOWN: LangSpec[] = [
  {
    id: "go",
    displayName: "Go",
    requiredPaths: ["tools/nix/templates/go.nix", "go/defs.bzl", "tools/scaffolding/templates/go"],
    kinds: ["cli", "lib", "test"],
    templatesDir: "tools/scaffolding/templates/go",
  },
];

type LangsCfg = { enabled?: string[] };

export async function detectEnabledLanguages(cwd = process.cwd()): Promise<LangSpec[]> {
  const cfgPath = path.join(cwd, "tools/nix/langs.json");
  let preferred: string[] = [];
  try {
    const txt = await fs.readFile(cfgPath, "utf8");
    preferred = (JSON.parse(txt)?.enabled || []) as string[];
  } catch {}
  const exists = async (p: string) => fs.pathExists(path.join(cwd, p));
  const out: LangSpec[] = [];
  for (const s of KNOWN) {
    if (preferred.length && !preferred.includes(s.id)) continue;
    let ok = true;
    for (const req of s.requiredPaths) {
      if (!(await exists(req))) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(s);
  }
  return out;
}

export function knownLanguages(): LangSpec[] {
  return [...KNOWN];
}
