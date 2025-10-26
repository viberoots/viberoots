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
    const res = await $({
      stdio: "pipe",
    })`nix build .#${attrPath} --impure --no-link --accept-flake-config`;
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
  try {
    console.error(
      `[diag] update-pnpm-hash importer=`,
      importer,
      ` storeAttr=`,
      storeAttr,
      ` lock=`,
      relLock,
    );
  } catch {}

  // If forcing, pre-write placeholder digest to bump the FOD derivation and force a rebuild
  if (force) {
    const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
    // Known placeholder value also used in node-modules.nix
    const placeholder = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await updateHashesJson(key, placeholder);
  }

  const first = await buildStore(storeAttr);
  if (first.ok) {
    console.log("pnpm-store:", storeAttr, "up to date");
    return;
  }
  const suggested = extractHash(first.output || "");
  if (!suggested) {
    console.error("failed to parse suggested sha256 from nix output\n\n" + first.output);
    process.exit(1);
  }
  const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
  try {
    console.error("[diag] update-pnpm-hash write hash for key=", key, " sha256=", suggested);
  } catch {}
  await updateHashesJson(key, suggested);
  const second = await buildStore(storeAttr);
  if (!second.ok) {
    console.error("pnpm-store still failing after hash update\n\n" + second.output);
    process.exit(1);
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
