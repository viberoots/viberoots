#!/usr/bin/env zx-wrapper
import path from "node:path";
import { isSupportedImporterLabel } from "./importers.ts";
import { normalizeNixAttr, providerNameForImporter, providerNameForNixAttr } from "./providers.ts";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

export type LockfileLabelInspection =
  | { kind: "not-lockfile" }
  | { kind: "malformed" }
  | {
      kind: "invalid-importer";
      lockfile: string;
      importer: string;
      expectedImporter: string;
    }
  | { kind: "ok"; lockfile: string; importer: string };

// Parse an importer-scoped PNPM lockfile label.
// Accepts forms like:
//   - lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web
//   - lockfile:pnpm-lock.yaml#.          (repo-root lockfiles only)
// Normalizes the lockfile path by stripping any number of repeated leading "./" segments.
function stripRepeatedLeadingDotSlashSegments(s: string): string {
  let out = String(s || "");
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

export function parseLockfileLabelParts(
  label: string,
): { lockfile: string; importer: string } | null {
  const s = String(label || "");
  if (!s.startsWith("lockfile:")) return null;
  const rest = s.slice("lockfile:".length);
  const hashIdx = rest.indexOf("#");
  if (hashIdx < 0) return null;
  // Must contain exactly one '#'
  if (rest.indexOf("#", hashIdx + 1) >= 0) return null;
  const pathPartRaw = rest.slice(0, hashIdx);
  const pathPart = stripRepeatedLeadingDotSlashSegments(pathPartRaw);
  const importer = rest.slice(hashIdx + 1);
  if (!pathPart || !importer) return null;
  return { lockfile: pathPart, importer };
}

export function inspectLockfileLabel(label: string): LockfileLabelInspection {
  const s = String(label || "");
  if (!s.startsWith("lockfile:")) return { kind: "not-lockfile" };

  const parsed = parseLockfileLabelParts(s);
  if (!parsed) return { kind: "malformed" };

  const expectedImporter = path.posix.dirname(parsed.lockfile);
  if (parsed.importer === ".") {
    if (expectedImporter !== ".") {
      return {
        kind: "invalid-importer",
        lockfile: parsed.lockfile,
        importer: parsed.importer,
        expectedImporter,
      };
    }
    return { kind: "ok", lockfile: parsed.lockfile, importer: parsed.importer };
  }

  if (parsed.importer !== expectedImporter) {
    return {
      kind: "invalid-importer",
      lockfile: parsed.lockfile,
      importer: parsed.importer,
      expectedImporter,
    };
  }
  return { kind: "ok", lockfile: parsed.lockfile, importer: parsed.importer };
}

export function parseLockfileLabel(label: string): { lockfile: string; importer: string } | null {
  const inspected = inspectLockfileLabel(label);
  if (inspected.kind !== "ok") return null;
  return { lockfile: inspected.lockfile, importer: inspected.importer };
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
      if (!isSupportedImporterLabel(parsed.importer)) continue;
      out.add(fqProviderLabel(providerNameForImporter(parsed.lockfile, parsed.importer)));
    } else if (l.startsWith("nixpkg:")) {
      const attr = normalizeNixAttr(l.slice("nixpkg:".length));
      out.add(fqProviderLabel(providerNameForNixAttr(attr)));
    }
  }
  return Array.from(out).sort();
}

// Drop Buck's configuration suffix that appears after a space and "(...)".
// Buck2 can emit multiple suffix shapes (e.g. "(config//...)" or "(root//:platform#...)").
export function dropConfigSuffix(label: string): string {
  return String(label || "").split(" (")[0];
}

// Convert labels like "root//projects/apps/foo:svc" or "prelude//build-tools/cpp:lib" to "//projects/apps/foo:svc" or "//build-tools/cpp:lib".
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
