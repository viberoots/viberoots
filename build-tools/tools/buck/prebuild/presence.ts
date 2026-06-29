#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getImporterRootsContract } from "../../lib/importer-roots";
import { parseLockfileLabel } from "../../lib/labels";
import { findUvLockfiles } from "../../lib/lockfiles";
import { providerNameForImporter } from "../../lib/providers";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  WORKSPACE_PROVIDER_DIR,
  providerAutoTargetsPath,
} from "../../lib/workspace-state-paths";

type NodeLockIndexSidecar = Partial<{
  index: Record<string, string>;
}>;

async function readNodeLockIndexLabels(): Promise<string[]> {
  let txt = "";
  try {
    txt = await fsp.readFile(DEFAULT_NODE_LOCK_INDEX_PATH, "utf8");
  } catch {
    return [];
  }
  if (!txt.trim()) return [];
  try {
    const parsed = JSON.parse(txt) as NodeLockIndexSidecar;
    const idx = parsed?.index && typeof parsed.index === "object" ? parsed.index : {};
    return Object.values(idx)
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function computeMissingOutputs(outputs: string[]): Promise<string[]> {
  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }

  {
    const preludePath = ".viberoots/current/prelude";
    const legacyPreludePath = "prelude";
    try {
      const st = await fsp.lstat(preludePath);
      if (!st.isDirectory() && !st.isSymbolicLink()) {
        outPresence.push("prelude (expected Nix store symlink)");
      } else {
        await fsp.access(path.join(preludePath, "prelude.bzl"));
      }
    } catch {
      try {
        const st = await fsp.lstat(legacyPreludePath);
        if (!st.isSymbolicLink()) {
          outPresence.push("prelude (expected Nix store symlink)");
        } else {
          const target = await fsp.readlink(legacyPreludePath).catch(() => "");
          if (!target.startsWith("/nix/store/")) {
            outPresence.push("prelude (expected Nix store symlink)");
          }
        }
      } catch {
        outPresence.push(preludePath);
      }
    }
  }

  // If any uv.lock exists, require TARGETS.python.auto
  {
    const { workspaceRoots } = getImporterRootsContract();
    const uvLocks = await findUvLockfiles({ roots: workspaceRoots });
    if (uvLocks.length > 0) {
      const pyAuto = providerAutoTargetsPath("python");
      if (!fs.existsSync(pyAuto)) outPresence.push(pyAuto);
    }
  }

  // If node-lock-index.json indicates any importer-scoped Node deps exist, require TARGETS.node.auto
  {
    const labels = await readNodeLockIndexLabels();
    if (labels.length > 0) {
      const nodeAuto = providerAutoTargetsPath("node");
      if (!fs.existsSync(nodeAuto)) outPresence.push(nodeAuto);
    }
  }

  // If any provider autos exist, require nix_attr_map.bzl (needed for provider index consumers)
  try {
    const provDir = WORKSPACE_PROVIDER_DIR;
    const autosPresent =
      fs.existsSync(provDir) && fs.readdirSync(provDir).some((f) => /^TARGETS.*\.auto$/.test(f));
    const nixMap = path.join(provDir, "nix_attr_map.bzl");
    if (autosPresent && !fs.existsSync(nixMap)) {
      outPresence.push(nixMap);
    }
  } catch {}

  return outPresence;
}

export function findGoImporterMissingSum(): string[] {
  const missing: string[] = [];
  const { workspaceRoots } = getImporterRootsContract();
  for (const base of workspaceRoots) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = path.join(base, d.name);
        const gm = fs.existsSync(path.join(dir, "go.mod"));
        const gs = fs.existsSync(path.join(dir, "go.sum"));
        if (gm && !gs) missing.push(dir);
      }
    } catch {}
  }
  return missing;
}

export function findMissingGomod2nixToml(): string[] {
  const missing: string[] = [];
  const { workspaceRoots } = getImporterRootsContract();
  for (const base of workspaceRoots) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = path.join(base, d.name);
        const gm = fs.existsSync(path.join(dir, "go.mod"));
        const gt = fs.existsSync(path.join(dir, "gomod2nix.toml"));
        if (gm && !gt) missing.push(path.join(dir, "gomod2nix.toml"));
      }
    } catch {}
  }
  return missing;
}

export async function findMissingNodeImporterProviders(): Promise<
  Array<{ lockfile: string; importer: string; provider: string }>
> {
  const missing: Array<{ lockfile: string; importer: string; provider: string }> = [];
  const labels = await readNodeLockIndexLabels();
  if (!labels.length) return missing;

  const targetsNodeAuto = providerAutoTargetsPath("node");
  const targetsNodeText = fs.existsSync(targetsNodeAuto)
    ? await fsp.readFile(targetsNodeAuto, "utf8").catch(() => "")
    : "";

  for (const lbl of labels) {
    const parsed = parseLockfileLabel(lbl);
    if (!parsed) continue;
    const lf = parsed.lockfile;
    const importerLabel = parsed.importer;
    const prov = providerNameForImporter(lf, importerLabel);
    const needle = `node_importer_deps(name="${prov}", lockfile="${lf}", importer="${importerLabel}"`;
    if (!targetsNodeText.includes(needle)) {
      missing.push({ lockfile: lf, importer: importerLabel, provider: prov });
    }
  }
  return missing;
}

export async function findMissingPythonImporterProviders(): Promise<
  Array<{ lockfile: string; importer: string; provider: string }>
> {
  const missing: Array<{ lockfile: string; importer: string; provider: string }> = [];
  try {
    const lockfiles = await findUvLockfiles();
    if (!lockfiles.length) return missing;

    const targetsPyAuto = providerAutoTargetsPath("python");
    const targetsPyText = fs.existsSync(targetsPyAuto)
      ? await fsp.readFile(targetsPyAuto, "utf8").catch(() => "")
      : "";

    const { workspaceRoots } = getImporterRootsContract();
    const isWorkspaceImporterLock = (lfRel: string) =>
      workspaceRoots.some((r) => lfRel === `${r}/uv.lock` || lfRel.startsWith(`${r}/`));

    for (const lfRel of lockfiles) {
      // Only consider importer roots allowed by the importer-roots contract.
      if (!isWorkspaceImporterLock(lfRel)) continue;
      const importerLabel = path.dirname(lfRel) || ".";
      const prov = providerNameForImporter(lfRel, importerLabel);
      const needle = `python_importer_deps(name="${prov}", lockfile="${lfRel}", importer="${importerLabel}"`;
      if (!targetsPyText.includes(needle)) {
        missing.push({ lockfile: lfRel, importer: importerLabel, provider: prov });
      }
    }
  } catch {}
  return missing;
}
