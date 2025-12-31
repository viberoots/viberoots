#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { providerNameForImporter } from "../../lib/providers.ts";
import { findUvLockfiles } from "../../lib/lockfiles.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";

export async function computeMissingOutputs(outputs: string[]): Promise<string[]> {
  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }
  // If any pnpm-lock.yaml exists, require TARGETS.node.auto
  try {
    let lockfiles: string[] = [];
    try {
      const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
      lockfiles = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {}
    if (lockfiles.length > 0) {
      const nodeAuto = "third_party/providers/TARGETS.node.auto";
      if (!fs.existsSync(nodeAuto)) outPresence.push(nodeAuto);
    }
  } catch {}

  // If any uv.lock exists, require TARGETS.python.auto
  try {
    let uvLocks: string[] = [];
    try {
      const { stdout } = await $`git ls-files '**/uv.lock'`;
      uvLocks = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {}
    if (uvLocks.length > 0) {
      const pyAuto = "third_party/providers/TARGETS.python.auto";
      if (!fs.existsSync(pyAuto)) outPresence.push(pyAuto);
    }
  } catch {}

  // If any provider autos exist, require nix_attr_map.bzl (needed for provider index consumers)
  try {
    const provDir = "third_party/providers";
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
  try {
    let lockfiles: string[] = [];
    try {
      const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
      lockfiles = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {}
    if (!lockfiles.length) return missing;

    const targetsNodeAuto = "third_party/providers/TARGETS.node.auto";
    const targetsNodeText = fs.existsSync(targetsNodeAuto)
      ? await fsp.readFile(targetsNodeAuto, "utf8").catch(() => "")
      : "";

    const haveYaml = await (async () => {
      try {
        await import("yaml");
        return true;
      } catch {
        return false;
      }
    })();
    for (const lf of lockfiles) {
      if (!haveYaml) break;
      try {
        const mod = await import("yaml");
        const YAML: any = (mod as any).default || mod;
        const doc = YAML.parse(await fsp.readFile(lf, "utf8")) as {
          importers?: Record<string, unknown>;
        };
        const importers = Object.keys(doc?.importers || {});
        for (const imp of importers) {
          const importerLabel = imp === "." ? path.dirname(lf) || "." : imp;
          const prov = providerNameForImporter(lf, importerLabel);
          const needle = `node_importer_deps(name="${prov}", lockfile="${lf}", importer="${importerLabel}"`;
          if (!targetsNodeText.includes(needle)) {
            missing.push({ lockfile: lf, importer: importerLabel, provider: prov });
          }
        }
      } catch {}
    }
  } catch {}
  return missing;
}

export async function findMissingPythonImporterProviders(): Promise<
  Array<{ lockfile: string; importer: string; provider: string }>
> {
  const missing: Array<{ lockfile: string; importer: string; provider: string }> = [];
  try {
    const lockfiles = await findUvLockfiles();
    if (!lockfiles.length) return missing;

    const targetsPyAuto = "third_party/providers/TARGETS.python.auto";
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
