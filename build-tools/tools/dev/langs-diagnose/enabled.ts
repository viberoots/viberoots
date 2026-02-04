import path from "node:path";
import type { LangEntry } from "./types";
import { pathExists } from "./fs";
import { findImporterLockfiles } from "../../lib/importers.ts";

export async function detectEnabledAndMissing(
  langs: Map<string, LangEntry>,
  enabledPref: Set<string>,
  filterId: string,
): Promise<{
  enabled: string[];
  disabled: Array<{ id: string; missingPaths: string[] }>;
}> {
  const enabled: string[] = [];
  const disabled: Array<{ id: string; missingPaths: string[] }> = [];

  const prefer = (id: string) => (enabledPref.size === 0 ? true : enabledPref.has(id));
  const existsAbs = async (rel: string) => pathExists(path.resolve(rel));

  const requiredPathLooksLikeLockfileGlob = (r: string): "pnpm" | "uv" | null => {
    const s = String(r || "");
    const isGlob = /[*?]/.test(s) || /\*\*\//.test(s);
    if (!isGlob) return null;
    if (/pnpm-lock\.yaml$/.test(s)) return "pnpm";
    if (/uv\.lock$/.test(s)) return "uv";
    return null;
  };

  const requiredPathPresent = (() => {
    let hasPnpmLockfile: boolean | null = null;
    let hasUvLockfile: boolean | null = null;
    const getHasPnpmLockfile = async () => {
      if (hasPnpmLockfile !== null) return hasPnpmLockfile;
      const found = await findImporterLockfiles(["pnpm-lock.yaml"]);
      hasPnpmLockfile = found.length > 0;
      return hasPnpmLockfile;
    };
    const getHasUvLockfile = async () => {
      if (hasUvLockfile !== null) return hasUvLockfile;
      const found = await findImporterLockfiles(["uv.lock"]);
      hasUvLockfile = found.length > 0;
      return hasUvLockfile;
    };
    return async (r: string): Promise<boolean> => {
      const kind = requiredPathLooksLikeLockfileGlob(r);
      if (kind === "pnpm") return await getHasPnpmLockfile();
      if (kind === "uv") return await getHasUvLockfile();
      if (/[*?]/.test(String(r || "")) || /\*\*\//.test(String(r || ""))) return false;
      return await existsAbs(r);
    };
  })();

  const ids = Array.from(langs.keys()).sort();
  for (const id of ids) {
    if (filterId && id !== filterId) continue;
    const e = langs.get(id) || { id };
    const req = Array.isArray(e.requiredPaths) ? e.requiredPaths : [];
    const missing: string[] = [];
    for (const r of req) {
      if (!(await requiredPathPresent(r))) missing.push(r);
    }
    if (prefer(id) && missing.length === 0) enabled.push(id);
    else disabled.push({ id, missingPaths: missing });
  }

  return { enabled, disabled };
}
