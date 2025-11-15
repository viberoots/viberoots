#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { renderTargetsFile, writeIfChanged } from "../../lib/fs-helpers.ts";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { providerNameForImporter, decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { findPnpmLockfiles } from "../../lib/lockfiles.ts";

type PNPMDoc = {
  importers: Record<string, any>;
  packages: Record<string, any>;
};

async function parsePnpmLock(file: string): Promise<PNPMDoc> {
  const mod = await import("yaml");
  const YAML: any = (mod as any).default || mod;
  const txt = await fsp.readFile(file, "utf8");
  return YAML.parse(txt) as PNPMDoc;
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
    // depRef can be a string (version) or an object like { specifier, version }
    const ver =
      typeof depRef === "string"
        ? depRef
        : (depRef && (depRef as any).version) || String(depRef || "");
    const key = `/${depName}/${ver}`;
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

  const lockfiles = await findPnpmLockfiles();

  async function haveYaml(): Promise<boolean> {
    try {
      await import("yaml");
      return true;
    } catch {
      return false;
    }
  }

  if (!lockfiles.length) {
    const header = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      "",
      "",
    ].join("\n");
    await writeIfChanged(OUT_FILE, renderTargetsFile(header, []));
    return;
  }

  const haveYamlMod = await haveYaml();

  const scanned = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    decodeKey: decodeNameVersionFromPatch,
    // Ensure deterministic ordering regardless of filesystem readdir order
    nameForKey: (k) => k,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  const seenNames = new Map<string, string>();
  const entries: string[] = [];

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    // Only generate providers for app/lib importers; skip repo-root lockfile
    if (!/^(apps|libs)\//.test(relLf)) continue;
    if (haveYamlMod) {
      const doc = await parsePnpmLock(lf);
      for (const importer of Object.keys(doc.importers || {})) {
        let importerLabel = importer === "." ? path.dirname(lf) || "." : importer;
        importerLabel = importerLabel.replace(/^\.\/+/, "") || ".";
        const eff = effectiveSetForImporter(doc, importer);
        const usedPatches = Array.from(eff)
          .map((k) => keyToPatchPath.get(k) || "")
          .filter(Boolean)
          .sort();
        // Discover importer-local patches for visibility (does not affect invalidation)
        const importerLocalDir = path.join(importerLabel, "patches", "node");
        let importerLocalPatches: string[] = [];
        try {
          const lst = await fsp.readdir(importerLocalDir);
          importerLocalPatches = lst
            .filter((f) => f.endsWith(".patch"))
            .map((f) => path.join(importerLocalDir, f).replace(/^\.\/+/, ""))
            .sort();
        } catch {
          importerLocalPatches = [];
        }
        const patchPaths = Array.from(
          new Set<string>([...usedPatches, ...importerLocalPatches]),
        ).sort();
        const name = providerNameForImporter(relLf, importerLabel);
        const key = `${relLf}#${importerLabel}`;
        const prev = seenNames.get(name);
        if (prev) {
          if (prev !== key) {
            throw new Error(`Provider name collision: ${name}\n${prev} vs ${key}`);
          } else {
            continue; // exact duplicate, skip
          }
        }
        seenNames.set(name, key);
        entries.push(
          `node_importer_deps(name="${name}", lockfile="${relLf}", importer="${importerLabel}", patch_paths=[${patchPaths
            .map((s) => `"${s}"`)
            .join(", ")}])`,
        );
      }
    } else {
      // No YAML available: still create a provider per lockfile with importer derived from path
      const importerLabel = path.dirname(relLf) || ".";
      const name = providerNameForImporter(relLf, importerLabel);
      const key = `${relLf}#${importerLabel}`;
      const prev = seenNames.get(name);
      if (prev) {
        if (prev !== key) {
          throw new Error(`Provider name collision: ${name}\n${prev} vs ${key}`);
        } else {
          continue;
        }
      }
      seenNames.set(name, key);
      entries.push(
        `node_importer_deps(name="${name}", lockfile="${relLf}", importer="${importerLabel}", patch_paths=[])`,
      );
    }
  }

  // Sort entries for deterministic output
  entries.sort();

  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
    "",
    "",
  ].join("\n");
  await writeIfChanged(OUT_FILE, renderTargetsFile(header, entries));

  // If OUT_FILE is not the main TARGETS, also synchronize an auto-managed section
  // inside third_party/providers/TARGETS so Buck can resolve lf_* labels.
  if (OUT_FILE !== "third_party/providers/TARGETS") {
    try {
      const targetFile = "third_party/providers/TARGETS";
      // Ensure directory exists so writes don't get swallowed
      try {
        await fsp.mkdir(path.dirname(targetFile), { recursive: true });
      } catch {}
      let cur = "";
      try {
        cur = await fsp.readFile(targetFile, "utf8");
      } catch {}
      const begin = "# BEGIN AUTO_NODE";
      const end = "# END AUTO_NODE";
      // Ensure defs_node.bzl load present near top
      const needLoad = 'load("//third_party/providers:defs_node.bzl", "node_importer_deps")';
      const autoBody = renderTargetsFile("", entries).trim();
      const autoSection = [begin, needLoad, "", autoBody, end, ""].join("\n");
      let next = cur;
      if (next.includes(begin) && next.includes(end)) {
        const pre = next.split(begin)[0].replace(/\n?$/, "\n");
        const post = next.split(end).slice(1).join(end);
        const postClean = post.replace(/^\n*/, "");
        next = pre + autoSection + postClean;
      } else {
        const prefix = next.endsWith("\n") || next === "" ? next : next + "\n";
        next = prefix + autoSection;
      }
      if (next !== cur) await fsp.writeFile(targetFile, next, "utf8");
    } catch {}
  }
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const out: Array<{ provider: string; key: string }> = [];
  const lockfiles = await findPnpmLockfiles();
  if (!lockfiles.length) return out;
  try {
    await import("yaml");
  } catch {
    return out;
  }

  // Reuse scan to know which patches exist; only needed to mirror provider naming stability
  const scanned = await scanFlatPatchDir({
    patchDir: "patches/node",
    decodeKey: decodeNameVersionFromPatch,
    nameForKey: (k) => k,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    if (!/^(apps|libs)\//.test(relLf)) continue;
    const doc = await parsePnpmLock(lf);
    for (const importer of Object.keys(doc.importers || {})) {
      const importerLabel = importer === "." ? path.dirname(lf) || "." : importer;
      const name = providerNameForImporter(lf, importerLabel);
      out.push({ provider: name, key: `lockfile:${lf}#${importerLabel}` });
    }
  }
  // Deterministic order
  out.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return out;
}
