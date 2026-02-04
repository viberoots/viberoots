import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { ResolveResult } from "./types";
import { createDbg } from "./lib/util";

type Gomod2Nix = Record<string, { version?: string; src?: { url?: string } } | any>;

const dbg = createDbg("go-module-resolve");

async function readGomod2nix(repoRoot: string): Promise<Gomod2Nix> {
  const tomlPath = path.join(repoRoot, "gomod2nix.toml");
  try {
    await fsp.access(tomlPath);
  } catch {
    throw new Error(
      "gomod2nix.toml not found; run build-tools/tools/dev/install-deps.ts after updating go.mod",
    );
  }
  // Minimal, forgiving parser: expect sections like ["<importPath>"] and a 'version = "..."' line
  const txt = await fsp.readFile(tomlPath, "utf8");
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
  dbg("resolveModuleVersion: keys", Object.keys(doc).length);
  const key = Object.keys(doc).find((k) => k.toLowerCase() === importPath.toLowerCase());
  if (!key) throw new Error(`module not found in gomod2nix.toml: ${importPath}`);
  const ent = doc[key];
  const v = (ent && (ent.version || ent.rev || ent.ref)) as string | undefined;
  if (!v) throw new Error(`missing version for ${importPath} in gomod2nix.toml`);
  dbg("resolveModuleVersion: hit", { importPath, version: v });
  return String(v);
}

export async function resolvePristineSource(importPath: string, version: string): Promise<string> {
  // Strategy: prefer explicit env override (tests), then GOMODCACHE env, then `go env GOMODCACHE`.
  const envCache = process.env.GOMODCACHE || process.env.NIX_GO_TEST_GOMODCACHE || "";
  let gomodcache = envCache.trim();
  dbg("resolvePristineSource: env GOMODCACHE", gomodcache || "<empty>");
  if (!gomodcache) {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile("go", ["env", "GOMODCACHE"], { encoding: "utf8" }, (err, out) => {
          if (err) return reject(err);
          resolve(out);
        });
      });
      gomodcache = String(stdout || "").trim();
    } catch {}
  }
  dbg("resolvePristineSource: computed GOMODCACHE", gomodcache || "<empty>");
  if (!gomodcache)
    throw new Error("cannot determine GOMODCACHE (set GOMODCACHE or NIX_GO_TEST_GOMODCACHE)");
  // Go's module cache layout uses paths like: $GOMODCACHE/<importPath>@<version>
  const candidate = path.join(gomodcache, importPath + "@" + version);
  dbg("resolvePristineSource: candidate", candidate);
  try {
    await fsp.access(candidate);
    return candidate;
  } catch {}
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
