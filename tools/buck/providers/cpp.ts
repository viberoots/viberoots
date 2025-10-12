#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Node = { name: string; labels?: string[] };

function normalizeAttr(attr: string): string {
  const s = String(attr || "").trim();
  if (!s) return s;
  let a = s.toLowerCase();
  if (!a.startsWith("pkgs.")) a = `pkgs.${a}`;
  if (a === "pkgs.gtest") a = "pkgs.googletest";
  return a;
}

function nameForAttr(attr: string): string {
  // pkgs.openssl -> pkgs_openssl, pkgs.gnome.glib -> pkgs_gnome_glib
  return `nix_pkgs_${attr.replace(/[^a-z0-9]+/g, "_")}`;
}

function encodeForPatchPrefix(attr: string): string {
  // pkgs.openssl -> pkgs/openssl -> pkgs__openssl
  return attr.replace(/\./g, "/").replace(/\//g, "__");
}

async function listCppPatchesFor(attr: string): Promise<string[]> {
  const dir = "patches/cpp";
  const out: string[] = [];
  if (!(await fs.pathExists(dir))) return out;
  const enc = encodeForPatchPrefix(attr);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".patch")) continue;
    if (!f.startsWith(`${enc}@`)) continue;
    out.push(path.join(dir, f));
  }
  out.sort();
  return out;
}

async function readCuratedProviders(): Promise<Array<{ name: string; attr: string }>> {
  const TARGETS = path.resolve("third_party/providers/TARGETS");
  try {
    const txt = await fs.readFile(TARGETS, "utf8");
    const out: Array<{ name: string; attr: string }> = [];
    // Match nix_cxx_library(name = "...", attr = "...") allowing whitespace
    const re = /nix_cxx_library\(\s*name\s*=\s*"([^"]+)",\s*attr\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const name = m[1];
      const rawAttr = m[2];
      out.push({ name, attr: normalizeAttr(rawAttr) });
    }
    return out;
  } catch {
    return [];
  }
}

export async function syncCppProviders(opts?: { outFile?: string }) {
  const OUT = opts?.outFile || "third_party/providers/TARGETS.cpp.auto";
  const graphPath = "tools/buck/graph.json";
  const overlay = "tools/nix/overlays/cpp-patches.nix";
  const lockfile = "flake.lock";

  const providerLines: string[] = [];
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_cpp.bzl", "nix_cxx_provider")',
    "",
  ].join("\n");

  let nodes: Node[] = [];
  if (await fs.pathExists(graphPath)) {
    try {
      const txt = await fs.readFile(graphPath, "utf8");
      const data = JSON.parse(txt) as Node[] | Record<string, any>;
      nodes = Array.isArray(data) ? (data as Node[]) : (Object.values(data) as Node[]);
    } catch {}
  }

  const attrs = new Set<string>();
  for (const n of nodes) {
    for (const l of n.labels || []) {
      if (typeof l === "string" && l.startsWith("nixpkg:")) {
        const a = normalizeAttr(l.slice("nixpkg:".length));
        if (a) attrs.add(a);
      }
    }
  }
  const attrList = Array.from(attrs).sort();

  // Also include curated providers declared in third_party/providers/TARGETS
  const curated = await readCuratedProviders();
  const curatedAttrSet = new Set<string>(curated.map((c) => c.attr));
  for (const a of curatedAttrSet) if (a) attrList.push(a);
  // Stable unique
  const seenAttrs = new Set<string>();
  const attrListUniq: string[] = [];
  for (const a of attrList.sort()) {
    if (seenAttrs.has(a)) continue;
    seenAttrs.add(a);
    attrListUniq.push(a);
  }

  const overlayPaths = (await fs.pathExists(overlay)) ? [overlay] : [];
  const hasLock = await fs.pathExists(lockfile).catch(() => false);

  // Prepare stamps directory and write one stamp per attr capturing input hashes
  const stampsDir = path.resolve("third_party/providers/stamps");
  await fs.mkdirp(stampsDir);

  for (const attr of attrListUniq) {
    const name = nameForAttr(attr);
    const patch_paths = await listCppPatchesFor(attr);
    const inputs: string[] = [];
    for (const p of overlayPaths) inputs.push(p);
    for (const p of patch_paths) inputs.push(p);
    if (hasLock) inputs.push(lockfile);
    // Compute a stable content hash over all inputs' contents and paths
    const chunks: string[] = [];
    for (const p of inputs) {
      try {
        const txt = await fs.readFile(p, "utf8");
        chunks.push(`# path=${p}`);
        chunks.push(txt);
      } catch {
        chunks.push(`# missing=${p}`);
      }
    }
    const data = chunks.join("\n");
    await fs.outputFile(path.join(stampsDir, `${name}.stamp`), data, "utf8");

    const lines: string[] = [];
    lines.push("nix_cxx_provider(");
    lines.push(`    name = \"${name}\",`);
    lines.push(`    attr = \"${attr}\",`);
    lines.push(")\n");
    providerLines.push(lines.join("\n"));
  }

  // Write stamps for curated providers using curated names (which may differ
  // from the auto-generated nameForAttr mapping, e.g., gtest vs googletest)
  for (const { name, attr } of curated) {
    const patch_paths = await listCppPatchesFor(attr);
    const inputs: string[] = [];
    for (const p of overlayPaths) inputs.push(p);
    for (const p of patch_paths) inputs.push(p);
    if (hasLock) inputs.push(lockfile);
    const chunks: string[] = [];
    for (const p of inputs) {
      try {
        const txt = await fs.readFile(p, "utf8");
        chunks.push(`# path=${p}`);
        chunks.push(txt);
      } catch {
        chunks.push(`# missing=${p}`);
      }
    }
    const data = chunks.join("\n");
    await fs.outputFile(path.join(stampsDir, `${name}.stamp`), data, "utf8");
  }

  const data = header + providerLines.join("\n");
  await fs.outputFile(OUT, data, "utf8");
}
