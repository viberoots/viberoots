import crypto from "node:crypto";

export function shortHash(s: string, n = 12): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
}

export const encodeForPatchFilename = (s: string) => s.replace(/\//g, "__");
export const decodeFromPatchFilename = (s: string) => s.replace(/__/g, "/");

export function providerNameForModuleKey(importPath: string, version: string): string {
  const key = `${importPath}@${version}`.toLowerCase();
  const h = shortHash(key, 12);
  const tail = `${importPath.split("/").slice(-2).join("_")}__${version.replace(/[.@]/g, "_")}`;
  return `mod_${h}_${tail}`;
}

export function providerNameForImporter(lockfilePath: string, importer: string): string {
  const key = `${lockfilePath}#${importer}`;
  const h = shortHash(key, 12);
  const tail = `${importer.replace(/[^\w]+/g, "_")}__${lockfilePath.replace(/[^\w]+/g, "_")}`;
  return `lf_${h}_${tail}`;
}
