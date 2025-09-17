#!/usr/bin/env zx-wrapper
// tools/buck/sync-providers-node.ts — optional Node importer-scoped providers
import fs from "fs-extra";
import crypto from "node:crypto";
import YAML from "yaml";

const PATCH_DIR = "patches/node";
const OUT_FILE = "third_party/providers/TARGETS.node.auto";

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function nameForImporterProvider(lockfilePath: string, importer: string): string {
  const key = `${lockfilePath}#${importer}`;
  const h = shortHash(key);
  const suffix =
    `${importer.replace(/[^\w]+/g, "_")}__${lockfilePath.replace(/[^\w]+/g, "_")}`.toLowerCase();
  return `lf_${h}_${suffix}`;
}

function pkgKeyFromPatch(filename: string): string | null {
  if (!filename.endsWith(".patch")) return null;
  return filename.slice(0, -".patch".length).toLowerCase(); // e.g., lodash@4.17.21
}

type PNPMDoc = {
  importers: Record<string, any>;
  packages: Record<string, any>;
};

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
      for (const [depName, depRef] of Object.entries(v.dependencies || {})) {
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
  const imp = doc.importers?.[importer] || {};
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
    const peerDeps = (doc.packages?.[k] as any)?.peerDependencies || {};
    for (const [pname] of Object.entries(peerDeps)) {
      const resolved = (doc.packages?.[k] as any)?.dependencies?.[pname];
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

async function main() {
  const entries: string[] = [];
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
  const nodePatches = (await fs.pathExists(PATCH_DIR))
    ? (await fs.readdir(PATCH_DIR)).filter((f) => f.endsWith(".patch"))
    : [];

  const seenNames = new Map<string, string>();

  for (const lf of lockfiles) {
    const doc = parsePnpmLock(lf);
    for (const importer of Object.keys(doc.importers || {})) {
      const eff = effectiveSetForImporter(doc, importer);
      const usedPatches = nodePatches
        .filter((p) => eff.has(pkgKeyFromPatch(p) || ""))
        .map((p) => `${PATCH_DIR}/${p}`)
        .sort();
      const name = nameForImporterProvider(lf, importer);
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
  ].join("\n");

  await fs.outputFile(OUT_FILE, header + "\n" + entries.join("\n") + "\n");
  console.log("wrote", OUT_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
