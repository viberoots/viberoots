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
  if (s.startsWith("/tmp/")) return [s, `/private${s}`];
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

function pathIsSameOrInside(root: string, parent: string): boolean {
  const r = normalizeForPrefixCompare(path.resolve(root));
  const p = normalizeForPrefixCompare(path.resolve(parent));
  return !!r && !!p && (r === p || r.startsWith(p + "/"));
}

export function rootIsSameOrInsideTempRepo(root: string, tmpRepoRoot: string): boolean {
  const rootVariants = maybeAddOrStripPrivatePrefix(path.resolve(root));
  const tmpVariants = maybeAddOrStripPrivatePrefix(path.resolve(tmpRepoRoot));
  return rootVariants.some((r) => tmpVariants.some((tmp) => pathIsSameOrInside(r, tmp)));
}

export function tempRootsForScopedReap(tmpRepoRoot: string, registeredRoots: string[]): string[] {
  const scopedTmp = normalizeForPrefixCompare(tmpRepoRoot);
  const candidates = scopedTmp ? [scopedTmp, ...registeredRoots] : registeredRoots;
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    const abs = normalizeForPrefixCompare(path.resolve(candidate));
    if (!abs) continue;
    if (scopedTmp && !rootIsSameOrInsideTempRepo(abs, scopedTmp)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    roots.push(abs);
  }
  return roots;
}
