#!/usr/bin/env zx-wrapper
/**
 * Canonical POSIX-ish path normalization helpers shared across importer/provider tooling.
 *
 * These helpers intentionally implement a small, behavior-preserving subset:
 * - normalize Windows separators to '/'
 * - strip leading './' segments
 * - represent "empty" as '.'
 *
 * Keep this as the single source of truth for importer/provider path normalization.
 */

export function toPosixPath(p: string): string {
  return (
    String(p || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "") || "."
  );
}

export function uniqSorted(list: string[]): string[] {
  const set = new Set<string>();
  for (const v of list || []) {
    const norm = toPosixPath(v);
    if (!norm) continue;
    set.add(norm);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
