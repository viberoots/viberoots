#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "./install/common.ts";
import { withExclusiveInstallLock } from "./install/lock.ts";

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // If the path doesn't exist yet (e.g., transient in temp), normalize segments instead
    return path.resolve(p);
  }
}

function parseArgs(argv: string[]): { lockfile?: string; force?: boolean } {
  let lockfile: string | undefined;
  let force = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lockfile" && i + 1 < argv.length) {
      lockfile = argv[i + 1];
      i++;
    } else if (a === "--force-store-rehash" || a === "--force") {
      force = true;
    }
  }
  return { lockfile, force };
}

function importerFromLockfile(lockArg: string): string {
  // Resolve potential macOS /var vs /private/var symlink differences by realpath-ing
  const cwd = safeRealpath(process.cwd());
  const lockAbs0 = path.isAbsolute(lockArg) ? lockArg : path.resolve(cwd, lockArg);
  const lockAbs = safeRealpath(lockAbs0);
  // Prefer extracting importer from absolute path segments under apps/* or libs/*
  const m = lockAbs.match(/(?:^|\/)(apps|libs)\/([^\/]+)\/pnpm-lock\.yaml$/);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }
  const rel = path.relative(cwd, lockAbs).split(path.sep).join("/");
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
  // Normalize and guard against escaping outside repo root
  const norm = path.posix.normalize(dir);
  if (norm.startsWith("../")) {
    // Fallback: if symlinks still confused the relative, derive from lockAbs under cwd
    const maybe = lockAbs.startsWith(cwd + "/") ? lockAbs.slice(cwd.length + 1) : lockAbs;
    const mdir = maybe.includes("/") ? maybe.slice(0, maybe.lastIndexOf("/")) : ".";
    return mdir;
  }
  return norm || ".";
}

function pnpmStoreAttrFromImporter(importer: string): string {
  // Flake exposes pnpm-store.<sanitized> aligned with templates-common.nix sanitizeName
  const normImp = normalizeImporter(importer);
  if (!normImp || normImp === ".") return "pnpm-store.default";
  const sanitized = sanitizeName(normImp);
  return `pnpm-store.${sanitized}`;
}

function pnpmStoreUnfixedAttrFromImporter(importer: string): string {
  const normImp = normalizeImporter(importer);
  if (!normImp || normImp === ".") return "pnpm-store-unfixed.default";
  const sanitized = sanitizeName(normImp);
  return `pnpm-store-unfixed.${sanitized}`;
}

function normalizeImporter(imp: string): string {
  if (!imp) return ".";
  // If absolute or contains temp prefixes, try to extract apps/* or libs/*
  const m = imp.match(/(?:^|\/)((apps|libs)\/[A-Za-z0-9._-]+)(?:\/.+)?$/);
  if (m && m[1]) return m[1];
  // If already relative like apps/x or libs/y keep it
  if (/^(apps|libs)\/[A-Za-z0-9._-]+$/.test(imp)) return imp;
  // Fallback to "." (root importer)
  return ".";
}

async function buildStore(attrPath: string): Promise<{ ok: boolean; output: string }> {
  try {
    const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim();
    const cores = String(process.env.NIX_CORES || "").trim();
    const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
    const cmd = [
      "set -euo pipefail;",
      'MJ="${NIX_MAX_JOBS:-' + (maxJobs || "0") + '}";',
      'CR="${NIX_CORES:-' + (cores || "0") + '}";',
      'TS="' + timeoutSec + '";',
      'TO=""; if command -v timeout >/dev/null 2>&1; then TO="timeout -k 10s ${TS}s "; elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout -k 10s ${TS}s "; fi;',
      'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
      'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
      `$TO nix build .#${attrPath} --impure --no-link --accept-flake-config --builders "" $JOBS_FLAG $CORES_FLAG`,
    ].join(" ");
    const res = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`;
    return { ok: true, output: String(res.stdout || "") + String(res.stderr || "") };
  } catch (e: any) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, output: out };
  }
}

function extractHash(text: string): string | null {
  const all = Array.from(text.matchAll(/sha256-[A-Za-z0-9+/=\-_]{43,}/g)).map((m) => m[0]);
  if (all.length) return all[all.length - 1];
  return null;
}

async function updateHashesJson(lockfileRel: string, newHash: string) {
  const file = path.join(process.cwd(), "tools", "nix", "node-modules.hashes.json");
  let obj: Record<string, string> = {};
  try {
    obj = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, string>;
  } catch {}
  obj[lockfileRel] = newHash;
  await fsp.writeFile(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function buildUnfixedAndHash(
  attrPath: string,
): Promise<{ ok: boolean; sri?: string; output?: string }> {
  try {
    const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim();
    const cores = String(process.env.NIX_CORES || "").trim();
    const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
    const cmd = [
      "set -euo pipefail;",
      'MJ="${NIX_MAX_JOBS:-' + (maxJobs || "0") + '}";',
      'CR="${NIX_CORES:-' + (cores || "0") + '}";',
      'TS="' + timeoutSec + '";',
      'TO=""; if command -v timeout >/dev/null 2>&1; then TO="timeout -k 10s ${TS}s "; elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout -k 10s ${TS}s "; fi;',
      'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
      'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
      `$TO nix build .#${attrPath} --impure --no-link --accept-flake-config --builders "" --print-out-paths $JOBS_FLAG $CORES_FLAG`,
    ].join(" ");
    const built = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`;
    const outPath =
      String(built.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop() || "";
    if (!outPath) {
      return { ok: false, output: "nix build returned no out path for " + attrPath };
    }
    // Hash the entire unfixed output path to match the fixed-output derivation's outputHash.
    // The output includes both 'store' and 'lockfile' directories; hashing only 'store'
    // would drift from the fixed-output derivation hash.
    const hashed = await $({
      stdio: "pipe",
    })`nix hash path --sri ${outPath}`;
    const sri = String(hashed.stdout || "").trim();
    if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(sri)) {
      return { ok: false, output: "unexpected hash-path output: " + sri };
    }
    return { ok: true, sri };
  } catch (e: any) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, output: out };
  }
}

async function currentSystem(): Promise<string> {
  try {
    const res = await $({ stdio: "pipe" })`nix eval --impure --expr builtins.currentSystem`;
    return String(res.stdout || "")
      .trim()
      .replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

async function flakeAttrExists(attrset: string, key: string): Promise<boolean> {
  try {
    const sys = await currentSystem();
    if (!sys) return false;
    const out = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c ${`nix eval .#packages.${sys}.${attrset} --apply 'builtins.hasAttr "${key}"' --accept-flake-config`}`;
    const val = String(out.stdout || "").trim();
    return val === "true";
  } catch {
    return false;
  }
}

async function inner() {
  const { lockfile, force } = parseArgs(process.argv);
  const repoRoot = process.cwd();
  // Normalize lockfile to be repo-root relative to avoid absolute importer names
  const relLock = (() => {
    const lf = lockfile ? lockfile : "pnpm-lock.yaml";
    // Use realpath to normalize /var vs /private/var
    const abs0 = path.isAbsolute(lf) ? lf : path.resolve(repoRoot, lf);
    const abs = safeRealpath(abs0);
    const rootReal = safeRealpath(repoRoot);
    return path.relative(rootReal, abs).split(path.sep).join("/");
  })();
  const importer = importerFromLockfile(relLock);
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const unfixedAttr = pnpmStoreUnfixedAttrFromImporter(importer);
  // quiet: avoid noisy diagnostics in normal operation
  const normImp = normalizeImporter(importer);
  const isDefault = !normImp || normImp === ".";
  const sanitized = isDefault ? "default" : sanitizeName(normImp);
  if (!isDefault) {
    const hasUnfixed = await flakeAttrExists("pnpm-store-unfixed", sanitized);
    if (!hasUnfixed) {
      return;
    }
  }

  // If forcing, pre-write placeholder digest to bump the FOD derivation and force a rebuild
  if (force) {
    const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
    // Known placeholder value also used in node-modules.nix
    const placeholder = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await updateHashesJson(key, placeholder);
  }

  // If importer lockfile is missing and generation is allowed, generate it OUTSIDE Nix first
  const impAbsGen = path.resolve(repoRoot, importer);
  const impLockGen = path.join(impAbsGen, "pnpm-lock.yaml");
  if (
    !fs.existsSync(impLockGen) &&
    String(process.env.NIX_PNPM_ALLOW_GENERATE || "").trim() === "1"
  ) {
    // Generate a lockfile in the importer; keep scripts disabled and include dev deps.
    // Ensure pnpm uses a writable local store/cache. Run from repo root to avoid
    // pnpm choosing the workspace root implicitly and write lockfile to importer dir.
    const impWs = path.join(impAbsGen, "pnpm-workspace.yaml");
    const hadLocalWs = fs.existsSync(impWs);
    try {
      if (!hadLocalWs) {
        await fsp.mkdir(impAbsGen, { recursive: true });
        await fsp.writeFile(impWs, "packages:\n  - ./\n", "utf8");
      }
    } catch {}
    await $({
      cwd: impAbsGen,
      stdio: "inherit",
    })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p ".pnpm-home" ".pnpm-store"; export PNPM_HOME="$(pwd)/.pnpm-home"; nix run ${repoRoot}#pnpm --accept-flake-config -- config set store-dir "$(pwd)/.pnpm-store"; nix run ${repoRoot}#pnpm --accept-flake-config -- install --lockfile-only --prod=false --ignore-scripts --lockfile-dir "." --dir "." --color never'`;
    // Fallback: if pnpm still wrote a root lockfile, seed the importer with it
    try {
      const rootLock = path.join(repoRoot, "pnpm-lock.yaml");
      if (!fs.existsSync(impLockGen) && fs.existsSync(rootLock)) {
        await fsp.mkdir(path.dirname(impLockGen), { recursive: true });
        await fsp.copyFile(rootLock, impLockGen);
      }
    } catch {}
    // Clean up temporary local workspace marker
    try {
      if (!hadLocalWs && fs.existsSync(impWs)) {
        await fsp.rm(impWs).catch(() => {});
      }
    } catch {}
  }

  // Helper: ensure importer lockfile exists and is up-to-date by generating it inside importer
  async function ensureImporterLockUpToDate() {
    const impAbsGen = path.resolve(repoRoot, importer);
    const impLockGen = path.join(impAbsGen, "pnpm-lock.yaml");
    // Generate a lockfile in the importer; keep scripts disabled and include dev deps.
    const impWs = path.join(impAbsGen, "pnpm-workspace.yaml");
    const hadLocalWs = fs.existsSync(impWs);
    try {
      if (!hadLocalWs) {
        await fsp.mkdir(impAbsGen, { recursive: true });
        await fsp.writeFile(impWs, "packages:\n  - ./\n", "utf8");
      }
    } catch {}
    await $({
      cwd: impAbsGen,
      stdio: "inherit",
    })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p ".pnpm-home" ".pnpm-store"; export PNPM_HOME="$(pwd)/.pnpm-home"; nix run ${repoRoot}#pnpm --accept-flake-config -- config set store-dir "$(pwd)/.pnpm-store"; nix run ${repoRoot}#pnpm --accept-flake-config -- install --lockfile-only --prod=false --ignore-scripts --lockfile-dir "." --dir "." --color never'`;
    // Fallback: if pnpm still wrote a root lockfile, seed the importer with it
    try {
      const rootLock = path.join(repoRoot, "pnpm-lock.yaml");
      if (!fs.existsSync(impLockGen) && fs.existsSync(rootLock)) {
        await fsp.mkdir(path.dirname(impLockGen), { recursive: true });
        await fsp.copyFile(rootLock, impLockGen);
      }
    } catch {}
    // Clean up temporary local workspace marker
    try {
      if (!hadLocalWs && fs.existsSync(impWs)) {
        await fsp.rm(impWs).catch(() => {});
      }
    } catch {}
  }

  // Robust path: build unfixed store and compute SRI from its normalized 'store' directory
  const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
  let pre = await buildUnfixedAndHash(unfixedAttr);
  // If the flake does not expose a per-importer attr for this importer, skip gracefully.
  if (!pre.ok && /does not provide attribute/.test(String(pre.output || ""))) {
    console.warn(
      `[update-pnpm-hash] skip: flake attr missing (${unfixedAttr}); continuing without per-importer store prewarm`,
    );
    return;
  }
  if (!pre.ok) {
    // Attempt to regenerate lock in importer (isolated workspace root), then retry once
    await ensureImporterLockUpToDate();
    pre = await buildUnfixedAndHash(unfixedAttr);
    if (!pre.ok && /does not provide attribute/.test(String(pre.output || ""))) {
      console.warn(
        `[update-pnpm-hash] skip after regen: flake attr still missing (${unfixedAttr})`,
      );
      return;
    }
    // If still failing or missing SRI, pre-seed a placeholder to force a suggestion on verify
    if (!pre.ok || !pre.sri) {
      const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
      const placeholder = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      await updateHashesJson(key, placeholder);
    }
  }
  if (pre.ok && pre.sri) {
    await updateHashesJson(key, pre.sri);
  }

  // Verify fixed-output build; if it still fails, fall back once to parsing suggestion
  const verify = await buildStore(storeAttr);
  if (!verify.ok) {
    if (/does not provide attribute/.test(String(verify.output || ""))) {
      console.warn(`[update-pnpm-hash] skip: flake attr missing (${storeAttr}); continuing`);
      return;
    }
    let suggested = extractHash(verify.output || "");
    if (!suggested && pre && pre.sri) {
      suggested = pre.sri;
    }
    if (!suggested) {
      const retry = await buildUnfixedAndHash(unfixedAttr);
      if (retry.ok && retry.sri) suggested = retry.sri;
    }
    if (!suggested) {
      console.error(
        "pnpm-store still failing and no suggested hash found\n\n" + (verify.output || ""),
      );
      process.exit(1);
    }
    await updateHashesJson(key, suggested);
    const final = await buildStore(storeAttr);
    if (!final.ok) {
      console.error("pnpm-store still failing after hash update\n\n" + final.output);
      process.exit(1);
    }
  }
  console.log("pnpm-store:", storeAttr, "hash updated and build succeeded");
}

async function main() {
  if (String(process.env.INSTALL_LOCK_SKIP || "").trim() === "1") {
    await inner();
    return;
  }
  await withExclusiveInstallLock("node-modules", inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
