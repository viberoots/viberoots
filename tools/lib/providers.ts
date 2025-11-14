import crypto from "node:crypto";
import {
  normalizeNixAttr,
  providerNameForImporter,
  providerNameForNixAttr,
} from "./provider-names.ts";

export function shortHash(s: string, n = 12): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
}

export const encodeForPatchFilename = (s: string) => s.replace(/\//g, "__");
// Be liberal in what we accept when decoding to allow tests to simulate duplicates on case-insensitive FS:
// Treat any group of 2+ underscores as a single '/'; then collapse multiple slashes.
export const decodeFromPatchFilename = (s: string) =>
  s.replace(/_{2,}/g, "/").replace(/\/{2,}/g, "/");

export function providerNameForModuleKey(importPath: string, version: string): string {
  const key = `${importPath}@${version}`.toLowerCase();
  const h = shortHash(key, 12);
  const tail = `${importPath.split("/").slice(-2).join("_")}__${version.replace(/[.@]/g, "_")}`;
  return `mod_${h}_${tail}`;
}

// Encode a nixpkgs attribute path for C++ patch filenames.
// Example: pkgs.openssl -> pkgs/openssl -> pkgs__openssl
export function encodeNixAttrForPatchPrefix(attr: string): string {
  return String(attr || "")
    .replace(/\./g, "/")
    .replace(/\//g, "__");
}

// Decode a C++ patch filename prefix back into a canonical nixpkgs attribute path.
// Example: pkgs__openssl -> pkgs/openssl -> pkgs.openssl (normalized)
export function decodeNixAttrFromPatchPrefix(prefix: string): string {
  const withSlashes = String(prefix || "").replace(/__+/g, "/");
  const dotted = withSlashes.replace(/\//g, ".");
  return normalizeNixAttr(dotted);
}

export {
  normalizeNixAttr,
  providerNameForImporter,
  providerNameForNixAttr,
} from "./provider-names.ts";
