import * as fsp from "node:fs/promises";
import path from "node:path";

// Must mirror tools/nix/templates-common.nix sanitizeName
export function sanitizeName(input: string): string {
  return input.replace(/\/\/|:|\/|\s/g, "-");
}

export function normalizeImporter(input: string | null | undefined): string {
  const imp = (input || "").trim();
  if (!imp) return ".";
  // Keep simple relative apps/* or libs/*
  if (/^(apps|libs)\/[A-Za-z0-9._-]+$/.test(imp)) return imp;
  // Extract apps/* or libs/* from any longer path
  const m = imp.match(/(?:^|\/)((apps|libs)\/[A-Za-z0-9._-]+)(?:\/.+)?$/);
  if (m && m[1]) return m[1];
  return ".";
}

export async function findNearestImporterLock(
  startCwd: string,
): Promise<{ importer: string; lockRel: string } | null> {
  let here = startCwd;
  // Prefer explicit repo root from WORKSPACE_ROOT for correct relative paths
  const envRoot = (process.env.WORKSPACE_ROOT || "").trim();
  const root = envRoot ? path.resolve(envRoot) : startCwd;
  while (true) {
    const cand = path.join(here, "pnpm-lock.yaml");
    const rel = path.relative(root, cand);
    const importer = path.dirname(rel) || ".";
    try {
      await fsp.access(cand);
      return { importer, lockRel: rel };
    } catch {}
    const next = path.dirname(here);
    if (next === here) break;
    here = next;
  }
  return null;
}

export function nodeModulesAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "node-modules.default" : `node-modules.${sanitizeName(imp)}`;
}

export function pnpmStoreAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "pnpm-store.default" : `pnpm-store.${sanitizeName(imp)}`;
}
