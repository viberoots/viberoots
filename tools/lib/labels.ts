#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

// Local, minimal provider helpers to avoid hard dependency on ./providers during sandboxed runs
function shortHash(s: string, n = 12): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
}

function normalizeNixAttrLocal(attr: string): string {
  const s = String(attr || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  let a = s.startsWith("pkgs.") ? s : `pkgs.${s}`;
  if (a === "pkgs.gtest") a = "pkgs.googletest";
  return a;
}

function providerNameForImporterLocal(lockfilePath: string, importer: string): string {
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

function providerNameForNixAttrLocal(attr: string): string {
  const norm = normalizeNixAttrLocal(attr);
  const tail = norm.replace(/[^a-z0-9]+/g, "_");
  return `nix_${tail}`;
}

// Returns fully qualified provider labels for supported mapping labels.

export function providersForLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l.startsWith("lockfile:")) {
      const rest = l.slice("lockfile:".length);
      const [path, importer = ""] = rest.split("#");
      if (!path || !importer) continue;
      out.add(fqProviderLabel(providerNameForImporterLocal(path, importer)));
    } else if (l.startsWith("nixpkg:")) {
      const attr = normalizeNixAttrLocal(l.slice("nixpkg:".length));
      out.add(fqProviderLabel(providerNameForNixAttrLocal(attr)));
    }
  }
  return Array.from(out).sort();
}

// Drop Buck's configuration suffix that appears after a space and "(config//...)".
export function dropConfigSuffix(label: string): string {
  return String(label || "").split(" (config//")[0];
}

// Convert labels like "root//apps/foo:svc" or "prelude//cpp:lib" to "//apps/foo:svc" or "//cpp:lib".
export function dropCellPrefix(label: string): string {
  const s = String(label || "");
  if (s.startsWith("//")) return s;
  const idx = s.indexOf("//");
  return idx >= 0 ? "//" + s.slice(idx + 2) : s;
}

// Normalize a fully-qualified Buck target for display/keys by dropping config suffixes and cell prefixes.
export function normalizeTargetLabel(label: string): string {
  return dropCellPrefix(dropConfigSuffix(label));
}

// Derive the Buck package path (without leading "//") from a target label.
export function packagePathFromLabel(label: string): string {
  const base = normalizeTargetLabel(label);
  const left = base.split(":")[0];
  return left.startsWith("//") ? left.slice(2) : left;
}

// Produce a safe, deterministic Nix attribute suffix from a Buck target label.
// Lower-case and map non [a-z0-9_] characters to underscores; prefix with 't' to ensure a valid identifier.
export function sanitizeAttrNameFromLabel(label: string): string {
  const s = normalizeTargetLabel(label).toLowerCase();
  return "t" + s.replace(/[^a-z0-9_]/g, "_");
}
