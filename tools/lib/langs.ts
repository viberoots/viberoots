#!/usr/bin/env zx-wrapper
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ScaffoldingLanguage } from "./lang-contracts";

type ManifestLang = Partial<ScaffoldingLanguage> & { id: string };
type ManifestObj =
  | ManifestLang[]
  | {
      enabled?: string[];
      languages?: ManifestLang[];
    };

function readManifestSync(cwd: string): { enabled: string[]; languages: ScaffoldingLanguage[] } {
  const cfgPath = path.join(cwd, "tools/nix/langs.json");
  try {
    const raw = fsSync.readFileSync(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as ManifestObj;
    const enabled: string[] = Array.isArray(parsed)
      ? []
      : Array.isArray(parsed.enabled)
        ? parsed.enabled!.map(String)
        : [];
    const list: ManifestLang[] = Array.isArray(parsed)
      ? (parsed as ManifestLang[])
      : Array.isArray(parsed.languages)
        ? (parsed.languages as ManifestLang[])
        : [];
    const languages: ScaffoldingLanguage[] = list
      .filter((e) => e && typeof e.id === "string")
      .map((e) => {
        return {
          id: String(e.id),
          displayName: String((e as any).displayName || e.id),
          requiredPaths: Array.isArray((e as any).requiredPaths)
            ? ((e as any).requiredPaths as string[])
            : [],
          optionalPaths: Array.isArray((e as any).optionalPaths)
            ? ((e as any).optionalPaths as string[])
            : [],
          kinds: Array.isArray((e as any).kinds) ? ((e as any).kinds as string[]) : [],
          templatesDir: String((e as any).templatesDir || ""),
        };
      });
    return { enabled, languages };
  } catch {
    return { enabled: [], languages: [] };
  }
}

export async function detectEnabledLanguages(cwd = process.cwd()): Promise<ScaffoldingLanguage[]> {
  const { enabled: preferred, languages } = readManifestSync(cwd);
  const exists = async (p: string) => {
    try {
      await fsp.access(path.join(cwd, p));
      return true;
    } catch {
      return false;
    }
  };
  const out: ScaffoldingLanguage[] = [];
  for (const s of languages) {
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
  const { languages } = readManifestSync(process.cwd());
  return [...languages];
}
