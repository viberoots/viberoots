#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { GoPkg, Tuple } from "./types.ts";

export let cacheHits = 0;
export let cacheMisses = 0;

function toHashInput(tuple: Tuple, roots: string[], modRootAbs: string): any {
  const modNorm = modRootAbs.startsWith("/private/var/")
    ? modRootAbs.slice("/private".length)
    : modRootAbs;
  return { tuple, modRoot: modNorm, roots: Array.from(new Set(roots)).sort() };
}

async function sha256OfFile(p: string): Promise<string> {
  try {
    const buf = await fsp.readFile(p);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

export async function runGoList(
  tuple: Tuple,
  roots: string[],
  cwd: string,
  cacheDir: string,
): Promise<GoPkg[]> {
  if (!roots.length) return [];
  const env = {
    ...process.env,
    GOOS: tuple.goos,
    GOARCH: tuple.goarch,
    CGO_ENABLED: tuple.cgo,
  } as any;
  const norm = Array.from(new Set(roots.map((r) => path.relative(cwd, r)))).map((rel) =>
    rel === "" ? "." : rel.startsWith(".") ? rel : `./${rel}`,
  );
  const args = ["list", "-deps", "-json", "-test", "-mod=mod", ...norm];
  const modRootAbs = path.resolve(cwd);
  const gomod = path.join(modRootAbs, "go.mod");
  const gosum = path.join(modRootAbs, "go.sum");
  const gomod2nix = path.resolve("gomod2nix.toml");
  const input = toHashInput(tuple, roots, modRootAbs);
  const lockHash =
    (await sha256OfFile(gomod2nix)) || (await sha256OfFile(gomod)) + (await sha256OfFile(gosum));
  const keyObj = { input, lockHash };
  const key = crypto.createHash("sha256").update(JSON.stringify(keyObj)).digest("hex");
  const cachePath = path.join(cacheDir, `${key}.json`);
  await ensureDir(cacheDir);
  try {
    await fsp.access(cachePath);
    cacheHits++;
    const txt = await fsp.readFile(cachePath, "utf8");
    return parseGoListStream(txt);
  } catch {}
  cacheMisses++;
  // Ensure module dependencies (including test-only) are available and go.sum is populated
  try {
    await $({ env, stdio: "pipe", cwd: modRootAbs })`go mod download all`;
  } catch {
    // best-effort; continue to go list which will report errors if unresolved
  }
  const { stdout } = await $({ env, stdio: "pipe", cwd })`go ${args}`;
  const raw = String(stdout);
  await fsp.writeFile(cachePath, raw, "utf8");
  return parseGoListStream(raw);
}

export function parseGoListStream(s: string): GoPkg[] {
  const out: GoPkg[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0 && buf.trim()) {
      try {
        const obj = JSON.parse(buf);
        out.push(obj as GoPkg);
      } catch {}
      buf = "";
    }
  }
  return out;
}

export function buildPkgIndexes(pkgs: GoPkg[]) {
  const byImport = new Map<string, GoPkg>();
  const byDir = new Map<string, GoPkg>();
  const testByDir = new Map<string, GoPkg[]>();
  function normalizeDir(d: string): string {
    if (d.startsWith("/private/var/")) return d.slice("/private".length);
    return d;
  }
  const baseCwd = normalizeDir(process.cwd());
  for (const p of pkgs) {
    if (p.ImportPath) byImport.set(p.ImportPath, p);
    if (p.Dir) {
      const dir = normalizeDir(p.Dir);
      const rel = path.relative(baseCwd, dir);
      const isTestPkg = (p.ImportPath || "").endsWith(".test") || (!!p.ForTest && p.ForTest !== "");
      const existing = byDir.get(rel);
      // Prefer non-test package for root mapping; only fall back to test pkg if none exists
      if (
        !existing ||
        (!isTestPkg &&
          existing &&
          ((existing.ImportPath || "").endsWith(".test") ||
            (existing.ForTest && existing.ForTest !== "")))
      ) {
        if (!isTestPkg || !byDir.has(rel)) {
          byDir.set(rel, p);
        }
      }
      if (isTestPkg) {
        const arr = testByDir.get(rel) || [];
        arr.push(p);
        testByDir.set(rel, arr);
      }
    }
  }
  return { byImport, byDir, testByDir };
}

export function reachableImports(from: GoPkg, byImport: Map<string, GoPkg>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [];
  const edges = new Set<string>([...(from.Deps || []), ...(from.Imports || [])]);
  for (const e of edges) stack.push(e);
  while (stack.length) {
    const ip = stack.pop()!;
    if (seen.has(ip)) continue;
    seen.add(ip);
    const p = byImport.get(ip);
    if (!p) continue;
    const next = new Set<string>([...(p.Deps || []), ...(p.Imports || [])]);
    for (const n of next) if (!seen.has(n)) stack.push(n);
  }
  return seen;
}
