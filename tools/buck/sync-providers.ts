#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import crypto from "node:crypto";
import path from "node:path";
import { decodeFromPatchFilename, providerNameForModuleKey } from "../lib/providers";

const PATCH_DIR = "patches/go";
const OUT_FILE = (argv.out as string) || "third_party/providers/TARGETS.auto";
const STRICT = String(argv.strict || "").toLowerCase() === "true" || argv.strict === true;

type Entry = { provider: string; moduleKey: string; patchPath: string };

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function decodeModuleKeyFromFilename(file: string): string | null {
  if (!file.endsWith(".patch")) return null;
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) return null;
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) return null;
  const importPath = decodeFromPatchFilename(enc);
  return `${importPath}@${ver}`.toLowerCase();
}

async function readEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  if (!(await fs.pathExists(PATCH_DIR))) return entries;
  const byModuleKey = new Map<string, string>(); // moduleKey -> filename
  const seenProvider = new Map<string, string>(); // provider -> moduleKey
  const list = await fs.readdir(PATCH_DIR, { withFileTypes: true });
  for (const e of list) {
    if (e.isDirectory()) {
      const msg = `[go] ignoring subdirectory ${e.name}`;
      if (STRICT) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    const key = decodeModuleKeyFromFilename(e.name);
    if (!key) {
      const msg = `[go] invalid or non-patch file in patches/go: ${e.name}`;
      if (STRICT) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    const prev = byModuleKey.get(key);
    if (prev && prev !== e.name) {
      throw new Error(`Duplicate patch for ${key}: ${prev} vs ${e.name}`);
    }
    byModuleKey.set(key, e.name);
    const at = key.lastIndexOf("@");
    const imp = key.slice(0, at);
    const ver = key.slice(at + 1);
    const provider = providerNameForModuleKey(imp, ver);
    const priorForProvider = seenProvider.get(provider);
    if (priorForProvider && priorForProvider !== key) {
      throw new Error(`Provider name collision: ${provider}\n${priorForProvider} vs ${key}`);
    }
    seenProvider.set(provider, key);
    entries.push({ provider, moduleKey: key, patchPath: path.join(PATCH_DIR, e.name) });
  }
  entries.sort((a, b) => a.provider.localeCompare(b.provider));
  return entries;
}

function render(entries: Entry[]): string {
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    `# Providers derived from filenames in ${PATCH_DIR}.`,
    "",
    'load("//third_party/providers:defs.bzl", "go_module_patch")',
    "",
  ].join("\n");
  const body = entries
    .map(
      (e) =>
        `go_module_patch(name = "${e.provider}", module_key = "${e.moduleKey}", patch_path = "${e.patchPath}",)`,
    )
    .join("\n");
  return header + body + (body ? "\n" : "");
}

async function writeIfChanged(dst: string, data: string) {
  const exists = await fs.pathExists(dst);
  if (exists) {
    const cur = await fs.readFile(dst, "utf8");
    const a = crypto.createHash("sha256").update(cur).digest("hex");
    const b = crypto.createHash("sha256").update(data).digest("hex");
    if (a === b) {
      console.log(`no-op (already applied): ${dst}`);
      return;
    }
  }
  await fs.outputFile(dst, data, "utf8");
  console.log("wrote", dst);
}

async function main() {
  const entries = await readEntries();
  const txt = render(entries);
  await writeIfChanged(OUT_FILE, txt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
