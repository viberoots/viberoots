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
export const decodeFromPatchFilename = (s: string) => s.replace(/__/g, "/");

// Patches-lint intentionally uses a slightly more permissive decoding to make it possible
// to exercise duplicate detection even on case-insensitive filesystems.
export const decodeFromPatchFilenameLoose = (s: string) =>
  decodeFromPatchFilename(s).replace(/\/{2,}/g, "/");

// Decode a flat patch filename "<name>@<version>.patch" into a canonical "name@version" key.
// - Accepts PNPM-style encoding where '/' is written as '__' in the filename
// - Uses the last '@' as the version separator to support scoped names like '@scope/name'
// - Returns lowercase "name@version" or null when the filename is not a .patch
export function decodeNameVersionFromPatch(filename: string): string | null {
  if (!filename || !filename.endsWith(".patch")) return null;
  const base = filename.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at <= 0 || at === base.length - 1) return null;
  const rawName = base.slice(0, at);
  const version = base.slice(at + 1);
  const name = decodeFromPatchFilename(rawName);
  return `${name}@${version}`.toLowerCase();
}

export function decodeNameVersionFromPatchLoose(filename: string): string | null {
  if (!filename || !filename.endsWith(".patch")) return null;
  const base = filename.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at <= 0 || at === base.length - 1) return null;
  const rawName = base.slice(0, at);
  const version = base.slice(at + 1);
  const name = decodeFromPatchFilenameLoose(rawName);
  return `${name}@${version}`.toLowerCase();
}

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
