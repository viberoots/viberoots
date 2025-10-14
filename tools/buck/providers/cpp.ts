#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { readGraph } from "../../lib/graph.ts";
import { validateFlatDir } from "../../lib/provider-sync.ts";
import {
  encodeNixAttrForPatchPrefix,
  normalizeNixAttr,
  providerNameForNixAttr,
} from "../../lib/providers.ts";

type Node = { name: string; labels?: string[] };

// Normalization and naming are shared across generators.
const normalizeAttr = normalizeNixAttr;
const nameForAttr = providerNameForNixAttr;

async function listCppPatchesFor(attr: string): Promise<string[]> {
  const dir = "patches/cpp";
  const out: string[] = [];
  if (!(await fs.pathExists(dir))) return out;
  // Validate directory flatness once per call site; warn by default
  await validateFlatDir(dir, false).catch(() => {});
  const enc = encodeNixAttrForPatchPrefix(attr);
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
    "",
  ].join("\n");

  let nodes: Node[] = [];
  if (await fs.pathExists(graphPath)) {
    try {
      nodes = (await readGraph(graphPath)) as Node[];
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
  // Stable unique using shared helper
  const { stableUnique } = await import("../../lib/fs-helpers.ts");
  const attrListUniq: string[] = stableUnique(attrList.sort(), (a) => a);

  const overlayPaths = (await fs.pathExists(overlay)) ? [overlay] : [];
  const hasLock = await fs.pathExists(lockfile).catch(() => false);

  // Prepare stamps directory and write one stamp per attr capturing input hashes
  const stampsDir = path.resolve("third_party/providers/stamps");
  await fs.mkdirp(stampsDir);

  for (const attr of attrListUniq) {
    const name = nameForAttr(attr);
    const patch_paths = await listCppPatchesFor(attr);
    const inputs = [
      ...overlayPaths.map((p) => ({ path: p })),
      ...patch_paths.map((p) => ({ path: p })),
      ...(hasLock ? [{ path: lockfile }] : []),
    ];
    const { writeStamp } = await import("../../lib/fs-helpers.ts");
    await writeStamp(path.join(stampsDir, `${name}.stamp`), inputs);

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
    const inputs = [
      ...overlayPaths.map((p) => ({ path: p })),
      ...patch_paths.map((p) => ({ path: p })),
      ...(hasLock ? [{ path: lockfile }] : []),
    ];
    const { writeStamp } = await import("../../lib/fs-helpers.ts");
    await writeStamp(path.join(stampsDir, `${name}.stamp`), inputs);
  }

  const { writeIfChanged, renderTargetsFile } = await import("../../lib/fs-helpers.ts");
  await writeIfChanged(OUT, renderTargetsFile(header, providerLines));

  // Also emit a deterministic mapping from provider targets to canonical nixpkg labels.
  // This enables C++ macros to consume attrs without brittle string heuristics.
  type MapEntry = { key: string; val: string };
  const mapEntries: MapEntry[] = [];
  // From auto-generated providers
  for (const attr of attrListUniq) {
    const name = nameForAttr(attr);
    mapEntries.push({
      key: `//third_party/providers:${name}`,
      val: `nixpkg:${attr}`,
    });
  }
  // From curated providers
  for (const { name, attr } of curated) {
    mapEntries.push({ key: `//third_party/providers:${name}`, val: `nixpkg:${attr}` });
  }
  // Stable unique by key, then sort by key
  const seenKeys = new Set<string>();
  const uniqSorted = mapEntries
    .filter((e) => {
      if (seenKeys.has(e.key)) return false;
      seenKeys.add(e.key);
      return true;
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const mapHeader = ["# GENERATED FILE — DO NOT EDIT.", "", "NIX_ATTR_MAP = {"].join("\n");
  const mapBody = uniqSorted.map((e) => `    \"${e.key}\": \"${e.val}\",`).join("\n");
  const mapFooter = "\n}\n";
  const mapText = mapHeader + (mapBody ? "\n" + mapBody : "") + mapFooter;
  await writeIfChanged("third_party/providers/nix_attr_map.bzl", mapText);
}
