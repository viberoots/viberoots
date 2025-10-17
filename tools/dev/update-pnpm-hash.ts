#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
// Use default environment; sanitizer no longer needed
import { withExclusiveInstallLock } from "./install/lock.ts";

function parseArgs(argv: string[]): { lockfile?: string } {
  let lockfile: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lockfile" && i + 1 < argv.length) {
      lockfile = argv[i + 1];
      i++;
    }
  }
  return { lockfile };
}

function importerFromLockfile(relLock: string): string {
  // Expect shape like apps/<name>/pnpm-lock.yaml or libs/<name>/pnpm-lock.yaml
  const parts = relLock.split("/");
  if (parts.length >= 3) return parts.slice(0, parts.length - 1).join("/");
  return ".";
}

function pnpmStoreAttrFromImporter(importer: string): string {
  // Flake exposes pnpm-store.<sanitized> or pnpm-store.default for root
  if (importer === ".") return "pnpm-store.default";
  const sanitized = importer.replace(/\/+|\:+|\s+/g, "_");
  return `pnpm-store.${sanitized}`;
}

async function buildStore(attrPath: string): Promise<{ ok: boolean; output: string }> {
  try {
    const res = await $({
      stdio: "pipe",
    })`nix build .#${attrPath} --no-link --accept-flake-config`;
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
  const { lockfile } = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const relLock = lockfile ? lockfile : "pnpm-lock.yaml";
  const importer = importerFromLockfile(relLock);
  const storeAttr = pnpmStoreAttrFromImporter(importer);

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
  await updateHashesJson(relLock, suggested);
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
