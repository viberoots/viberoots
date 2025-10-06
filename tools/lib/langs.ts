#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import type { ScaffoldingLanguage } from "./lang-contracts";

const KNOWN: ScaffoldingLanguage[] = [
  {
    id: "go",
    displayName: "Go",
    requiredPaths: ["tools/nix/templates/go.nix", "go/defs.bzl"],
    optionalPaths: [],
    kinds: ["cli", "lib", "test"],
    capabilities: {
      patching: true,
      lockfileLabels: false,
      testAutoWire: true,
    },
    templatesDir: "tools/scaffolding/templates/go",
  },
  {
    id: "cpp",
    displayName: "C++",
    requiredPaths: ["tools/nix/templates/cpp.nix", "cpp/defs.bzl"],
    optionalPaths: [],
    kinds: ["cli", "lib", "test"],
    capabilities: {
      patching: false,
      lockfileLabels: false,
      testAutoWire: false,
    },
    templatesDir: "tools/scaffolding/templates/cpp",
  },
  {
    id: "node",
    displayName: "Node",
    requiredPaths: ["**/pnpm-lock.yaml"],
    optionalPaths: ["patches/node"],
    kinds: ["app", "lib", "workspace"],
    capabilities: {
      patching: true,
      lockfileLabels: true,
      testAutoWire: false,
    },
    templatesDir: "tools/scaffolding/templates/node",
  },
] as any;

export async function detectEnabledLanguages(cwd = process.cwd()): Promise<ScaffoldingLanguage[]> {
  const cfgPath = path.join(cwd, "tools/nix/langs.json");
  let preferred: string[] = [];
  try {
    const txt = await fs.readFile(cfgPath, "utf8");
    preferred = (JSON.parse(txt)?.enabled || []) as string[];
  } catch {}
  const exists = async (p: string) => fs.pathExists(path.join(cwd, p));
  const out: ScaffoldingLanguage[] = [];
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

export function knownLanguages(): ScaffoldingLanguage[] {
  return [...KNOWN];
}
