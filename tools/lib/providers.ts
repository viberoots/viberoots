import crypto from "node:crypto";

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

export function providerNameForImporter(lockfilePath: string, importer: string): string {
  const key = `${lockfilePath}#${importer}`;
  const h = shortHash(key, 12);
  const tail = `${importer.replace(/[^\w]+/g, "_")}__${lockfilePath.replace(/[^\w]+/g, "_")}`;
  return `lf_${h}_${tail}`;
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

// Normalize a nixpkgs attribute path for provider naming and labeling.
// - Trims
// - Lower-cases
// - Ensures "pkgs." prefix
// - Maps historical alias pkgs.gtest -> pkgs.googletest
export function normalizeNixAttr(attr: string): string {
  const s = String(attr || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  let a = s.startsWith("pkgs.") ? s : `pkgs.${s}`;
  if (a === "pkgs.gtest") a = "pkgs.googletest";
  return a;
}

// Deterministic provider name for a nixpkgs attribute path.
// Example: pkgs.zlib -> nix_pkgs_pkgs_zlib, pkgs.gnome.glib -> nix_pkgs_pkgs_gnome_glib
export function providerNameForNixAttr(attr: string): string {
  const norm = normalizeNixAttr(attr);
  const tail = norm.replace(/[^a-z0-9]+/g, "_");
  return `nix_pkgs_${tail}`;
}
