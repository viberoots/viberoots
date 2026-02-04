import { shortHash } from "./short-hash.ts";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

function loadAliasMap(): Record<string, string> {
  try {
    const here = fileURLToPath(import.meta.url);
    const jsonPath = path.join(path.dirname(here), "nix-attr-aliases.json");
    const data = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string") {
        const key = k.trim().toLowerCase();
        const val = v.trim().toLowerCase();
        if (key && val) m[key] = val;
      }
    }
    return m;
  } catch {
    return {};
  }
}

// Normalize a nixpkgs attribute path for provider naming and labeling.
// - Trims
// - Lower-cases
// - Ensures "pkgs." prefix
// - Maps historical alias pkgs.gtest -> pkgs.googletest
export function normalizeNixAttr(attr: string): string {
  // Prefer JSON source of truth; tolerate missing/invalid at runtime.
  const NIX_ATTR_ALIASES: Record<string, string> = loadAliasMap();

  const s = String(attr || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  let a = s.startsWith("pkgs.") ? s : `pkgs.${s}`;
  const alias = NIX_ATTR_ALIASES[a];
  if (alias) a = alias;
  // Sparse/partial clone fallback for parity with Starlark/Nix
  if (a === "pkgs.gtest") a = "pkgs.googletest";
  return a;
}

// Deterministic provider name for a nixpkgs attribute path.
// Example: pkgs.zlib -> nix_pkgs_zlib, pkgs.gnome.glib -> nix_pkgs_gnome_glib
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
