#!/usr/bin/env zx-wrapper
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { LanguageHermeticContract, ScaffoldingLanguage } from "./lang-contracts";
import { findImporterLockfiles } from "./importers";

type ManifestLang = Partial<ScaffoldingLanguage> & { id: string };
type ManifestObj =
  | ManifestLang[]
  | {
      enabled?: string[];
      languages?: ManifestLang[];
    };

function readManifestSync(cwd: string): {
  enabled: string[];
  enabledDeclared: boolean;
  languages: ScaffoldingLanguage[];
} {
  const cfgPath = path.join(cwd, "build-tools/tools/nix/langs.json");
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
          hermetic: (e as any).hermetic as LanguageHermeticContract,
        };
      });
    return {
      enabled,
      enabledDeclared: !Array.isArray(parsed) && Array.isArray(parsed.enabled),
      languages,
    };
  } catch {
    return { enabled: [], enabledDeclared: false, languages: [] };
  }
}

export async function detectEnabledLanguages(cwd = process.cwd()): Promise<ScaffoldingLanguage[]> {
  const { enabled: preferred, enabledDeclared, languages } = readManifestSync(cwd);
  const exists = async (p: string) => {
    try {
      await fsp.access(path.join(cwd, p));
      return true;
    } catch {
      return false;
    }
  };
  async function matchesGlob(req: string): Promise<boolean> {
    const r = String(req || "");
    // Minimal, fast-path glob handling for repo-wide lockfiles:
    // - **/pnpm-lock.yaml
    // - **/uv.lock
    if (/\*\*\/pnpm-lock\.yaml$/.test(r) || /pnpm-lock\.yaml$/.test(r)) {
      const found = await findImporterLockfiles(["pnpm-lock.yaml"]);
      return found.length > 0;
    }
    if (/\*\*\/uv\.lock$/.test(r) || /uv\.lock$/.test(r)) {
      const found = await findImporterLockfiles(["uv.lock"]);
      return found.length > 0;
    }
    // For any other pattern, fall back to strict path check (no glob support).
    return exists(r);
  }
  const out: ScaffoldingLanguage[] = [];
  for (const s of languages) {
    if (s.hermetic?.status !== "graduated") continue;
    if (enabledDeclared && !preferred.includes(s.id)) continue;
    let ok = true;
    for (const req of s.requiredPaths) {
      const isGlob = /[*?]/.test(req) || /\*\*\//.test(req);
      const present = isGlob ? await matchesGlob(req) : await exists(req);
      if (!present) {
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
