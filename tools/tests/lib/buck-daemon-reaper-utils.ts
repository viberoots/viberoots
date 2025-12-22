import path from "node:path";

function normalizeForPrefixCompare(p: string): string {
  const s = String(p || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

function maybeAddOrStripPrivatePrefix(p: string): string[] {
  const s = normalizeForPrefixCompare(p);
  if (!s) return [];
  if (s.startsWith("/private/")) return [s, s.replace(/^\/private/, "")];
  if (s.startsWith("/var/")) return [s, `/private${s}`];
  return [s];
}

export function cwdPrefixesForTempRepo(tmpRepoRoot: string): string[] {
  const root = normalizeForPrefixCompare(tmpRepoRoot);
  if (!root) return [];
  const prefixes = new Set<string>();
  for (const r of maybeAddOrStripPrivatePrefix(root)) {
    prefixes.add(r);
    prefixes.add(path.posix.join(r, "buck-out"));
    prefixes.add(path.posix.join(r, ".buck"));
  }
  return Array.from(prefixes).filter(Boolean);
}

export function cwdIsInsideTempRepo(cwd: string, tmpRepoRoot: string): boolean {
  const c = normalizeForPrefixCompare(cwd);
  if (!c) return false;
  const prefixes = cwdPrefixesForTempRepo(tmpRepoRoot);
  return prefixes.some((p) => c === p || c.startsWith(p + "/"));
}
