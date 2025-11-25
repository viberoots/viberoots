#!/usr/bin/env zx-wrapper
import { normalizeNixAttr, providerNameForImporter, providerNameForNixAttr } from "./providers.ts";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

// Parse an importer-scoped PNPM lockfile label.
// Accepts forms like:
//   - lockfile:apps/web/pnpm-lock.yaml#apps/web
//   - lockfile:pnpm-lock.yaml#.
// Normalizes the lockfile path by stripping any leading "./".
export function parseLockfileLabel(label: string): { lockfile: string; importer: string } | null {
  const s = String(label || "");
  if (!s.startsWith("lockfile:")) return null;
  const rest = s.slice("lockfile:".length);
  const hashIdx = rest.indexOf("#");
  if (hashIdx < 0) return null;
  const pathPart = rest.slice(0, hashIdx).replace(/^\.\/+/, "");
  const importer = rest.slice(hashIdx + 1);
  if (!pathPart || !importer) return null;
  return { lockfile: pathPart, importer };
}

export function isImporterScopedLockfileLabel(label: string): boolean {
  return parseLockfileLabel(label) !== null;
}

// Returns fully qualified provider labels for supported mapping labels.

export function providersForLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l && l.startsWith("lockfile:")) {
      const parsed = parseLockfileLabel(l);
      if (!parsed) continue;
      out.add(fqProviderLabel(providerNameForImporter(parsed.lockfile, parsed.importer)));
    } else if (l.startsWith("nixpkg:")) {
      const attr = normalizeNixAttr(l.slice("nixpkg:".length));
      out.add(fqProviderLabel(providerNameForNixAttr(attr)));
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
