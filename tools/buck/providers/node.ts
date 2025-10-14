#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import YAML from "yaml";
import { renderTargetsFile, writeIfChanged } from "../../lib/fs-helpers.ts";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { providerNameForImporter } from "../../lib/providers.ts";

type PNPMDoc = {
  importers: Record<string, any>;
  packages: Record<string, any>;
};

function pkgKeyFromPatch(filename: string): string | null {
  if (!filename.endsWith(".patch")) return null;
  return filename.slice(0, -".patch".length).toLowerCase();
}

function parsePnpmLock(file: string): PNPMDoc {
  return YAML.parse(fs.readFileSync(file, "utf8")) as PNPMDoc;
}

function buildGraph(doc: PNPMDoc) {
  const nodes = new Map<string, { name: string; version: string; deps: Set<string> }>();
  for (const [k, v] of Object.entries(doc.packages || {})) {
    const parts = k.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      const version = parts[0].startsWith("@") ? parts[2] || "" : parts[1] || "";
      const deps = new Set<string>();
      for (const [depName, depRef] of Object.entries((v as any).dependencies || {})) {
        const key1 = `/${depName}/${depRef}`;
        if ((doc.packages || {})[key1]) deps.add(key1);
      }
      nodes.set(k, { name, version, deps });
    }
  }
  return nodes;
}

function effectiveSetForImporter(doc: PNPMDoc, importer: string): Set<string> {
  const nodes = buildGraph(doc);
  const out = new Set<string>();
  const imp = (doc.importers as any)?.[importer] || {};
  const roots = new Set<string>();
  const addRoot = (depName: string, depRef: any) => {
    const key = `/${depName}/${depRef}`;
    if (nodes.has(key)) roots.add(key);
  };
  for (const [depName, depRef] of Object.entries(imp.dependencies || {}))
    addRoot(depName as string, depRef);
  for (const [depName, depRef] of Object.entries(imp.optionalDependencies || {}))
    addRoot(depName as string, depRef);
  for (const [depName, depRef] of Object.entries(imp.peerDependencies || {}))
    addRoot(depName as string, (imp.dependencies || {})[depName] || depRef);
  const q = [...roots];
  while (q.length) {
    const k = q.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    const pkg = nodes.get(k);
    for (const d of pkg?.deps || []) q.push(d as string);
    const peerDeps = (doc.packages as any)?.[k]?.peerDependencies || {};
    for (const [pname] of Object.entries(peerDeps)) {
      const resolved = (doc.packages as any)?.[k]?.dependencies?.[pname as string];
      if (resolved) {
        const peerKey = `/${pname}/${resolved}`;
        if (nodes.has(peerKey)) q.push(peerKey);
      }
    }
  }
  const set = new Set<string>();
  for (const k of out) {
    const parts = k.split("/").filter(Boolean);
    const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    const version = parts[0].startsWith("@") ? parts[2] || "" : parts[1] || "";
    set.add(`${name}@${version}`.toLowerCase());
  }
  return set;
}

export async function syncNodeProviders(opts?: { outFile?: string; patchDir?: string }) {
  const PATCH_DIR = opts?.patchDir || "patches/node";
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.node.auto";

  let lockfiles: string[] = [];
  try {
    const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
    lockfiles = String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    lockfiles = [];
  }

  const haveYaml = (() => {
    try {
      require.resolve("yaml");
      return true;
    } catch {
      return false;
    }
  })();

  if (!lockfiles.length || !haveYaml) {
    const header = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      "",
      "",
    ].join("\n");
    await writeIfChanged(OUT_FILE, renderTargetsFile(header, []));
    return;
  }

  const scanned = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    decodeKey: pkgKeyFromPatch,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  const seenNames = new Map<string, string>();
  const entries: string[] = [];

  for (const lf of lockfiles) {
    const doc = parsePnpmLock(lf);
    for (const importer of Object.keys(doc.importers || {})) {
      const eff = effectiveSetForImporter(doc, importer);
      const usedPatches = Array.from(eff)
        .map((k) => keyToPatchPath.get(k) || "")
        .filter(Boolean)
        .sort();
      const name = providerNameForImporter(lf, importer);
      const key = `${lf}#${importer}`;
      const prev = seenNames.get(name);
      if (prev && prev !== key)
        throw new Error(`Provider name collision: ${name}\n${prev} vs ${key}`);
      seenNames.set(name, key);
      entries.push(
        `node_importer_deps(name="${name}", lockfile="${lf}", importer="${importer}", patch_paths=[${usedPatches
          .map((s) => `"${s}"`)
          .join(", ")}])`,
      );
    }
  }

  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
    "",
    "",
  ].join("\n");
  await writeIfChanged(OUT_FILE, renderTargetsFile(header, entries));
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const out: Array<{ provider: string; key: string }> = [];
  let lockfiles: string[] = [];
  try {
    const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
    lockfiles = String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    lockfiles = [];
  }
  const haveYaml = (() => {
    try {
      require.resolve("yaml");
      return true;
    } catch {
      return false;
    }
  })();
  if (!lockfiles.length || !haveYaml) return out;

  // Reuse scan to know which patches exist; only needed to mirror provider naming stability
  const scanned = await scanFlatPatchDir({ patchDir: "patches/node", decodeKey: pkgKeyFromPatch });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  for (const lf of lockfiles) {
    const doc = parsePnpmLock(lf);
    for (const importer of Object.keys(doc.importers || {})) {
      const name = providerNameForImporter(lf, importer);
      out.push({ provider: name, key: `lockfile:${lf}#${importer}` });
    }
  }
  // Deterministic order
  out.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return out;
}
