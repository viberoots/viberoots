import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveImporterDir } from "../../lib/lockfiles.ts";
import { sanitizeName as sanitizeNameContract } from "../../lib/sanitize.ts";

// Must mirror tools/nix/templates-common.nix sanitizeName
export function sanitizeName(input: string): string {
  return sanitizeNameContract(input);
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
  try {
    const importer = await resolveImporterDir(startCwd);
    const lockRel = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
    return { importer, lockRel };
  } catch {
    return null;
  }
}

export function nodeModulesAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "node-modules.default" : `node-modules.${sanitizeName(imp)}`;
}

export function pnpmStoreAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "pnpm-store.default" : `pnpm-store.${sanitizeName(imp)}`;
}
