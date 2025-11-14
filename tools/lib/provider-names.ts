import crypto from "node:crypto";

function shortHash(s: string, n = 12): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
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
// Example: pkgs.zlib -> nix_zlib, pkgs.gnome.glib -> nix_gnome_glib
export function providerNameForNixAttr(attr: string): string {
  const norm = normalizeNixAttr(attr);
  const tail = norm.replace(/[^a-z0-9]+/g, "_");
  return `nix_${tail}`;
}

// Deterministic provider name for a PNPM lockfile importer.
export function providerNameForImporter(lockfilePath: string, importer: string): string {
  const normPath = String(lockfilePath || "")
    .replace(/^\.\/+/, "")
    .replace(/\/+/, "/");
  const normImporter = String(importer || "")
    .replace(/^\.\/+/, "")
    .replace(/\/+/, "/");
  const key = `${normPath}#${normImporter}`;
  const h = shortHash(key, 12);
  const tail = `${normImporter.replace(/[^\w]+/g, "_")}__${normPath.replace(/[^\w]+/g, "_")}`;
  return `lf_${h}_${tail}`;
}
