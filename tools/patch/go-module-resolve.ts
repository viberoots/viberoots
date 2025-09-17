import fs from "fs-extra";
import path from "node:path";
import type { ResolveResult } from "./types";

type Gomod2Nix = Record<string, { version?: string; src?: { url?: string } } | any>;

async function readGomod2nix(repoRoot: string): Promise<Gomod2Nix> {
  const tomlPath = path.join(repoRoot, "gomod2nix.toml");
  if (!(await fs.pathExists(tomlPath))) {
    throw new Error(
      "gomod2nix.toml not found; run tools/dev/install-deps.ts after updating go.mod",
    );
  }
  // Minimal, forgiving parser: expect sections like ["<importPath>"] and a 'version = "..."' line
  const txt = await fs.readFile(tomlPath, "utf8");
  const out: Gomod2Nix = {};
  let current: string | null = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const mSec = line.match(/^\["?([^\]"]+)"?\]$/);
    if (mSec) {
      current = mSec[1];
      out[current] ||= {};
      continue;
    }
    if (current) {
      const mVer = line.match(/^version\s*=\s*"([^"]+)"/);
      if (mVer) {
        (out[current] as any).version = mVer[1];
      }
    }
  }
  return out;
}

export async function resolveModuleVersion(importPath: string): Promise<string> {
  const repoRoot = process.cwd();
  const doc = await readGomod2nix(repoRoot);
  const key = Object.keys(doc).find((k) => k.toLowerCase() === importPath.toLowerCase());
  if (!key) throw new Error(`module not found in gomod2nix.toml: ${importPath}`);
  const ent = doc[key];
  const v = (ent && (ent.version || ent.rev || ent.ref)) as string | undefined;
  if (!v) throw new Error(`missing version for ${importPath} in gomod2nix.toml`);
  return String(v);
}

export async function resolvePristineSource(importPath: string, version: string): Promise<string> {
  // Strategy: prefer explicit env override (tests), then GOMODCACHE env, then `go env GOMODCACHE`.
  const envCache = process.env.GOMODCACHE || process.env.NIX_GO_TEST_GOMODCACHE || "";
  let gomodcache = envCache.trim();
  if (!gomodcache) {
    try {
      const { stdout } = await $`go env GOMODCACHE`;
      gomodcache = String(stdout || "").trim();
    } catch {
      // no go tool; remain empty
    }
  }
  if (!gomodcache)
    throw new Error("cannot determine GOMODCACHE (set GOMODCACHE or NIX_GO_TEST_GOMODCACHE)");
  // Go's module cache layout uses paths like: $GOMODCACHE/<importPath>@<version>
  const candidate = path.join(gomodcache, importPath + "@" + version);
  if (await fs.pathExists(candidate)) {
    return candidate;
  }
  throw new Error(`pristine source not found in GOMODCACHE: ${candidate}`);
}

export async function resolveModule(importPath: string): Promise<ResolveResult> {
  // Test-only fast path: allow explicit mapping via NIX_GO_TEST_RESOLVE_JSON
  const testJson = process.env.NIX_GO_TEST_RESOLVE_JSON || "";
  if (testJson.trim()) {
    try {
      const map = JSON.parse(testJson) as Record<string, { version: string; originPath: string }>;
      const ent = map[importPath];
      if (ent?.version && ent?.originPath) {
        return { importPath, version: ent.version, originPath: ent.originPath };
      }
    } catch {}
  }
  const version = await resolveModuleVersion(importPath);
  const originPath = await resolvePristineSource(importPath, version);
  return { importPath, version, originPath };
}
