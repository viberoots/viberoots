#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { ensureNixStoreToolPathSync } from "./tool-paths";

const execFileAsync = promisify(execFile);

export type PNPMDoc = {
  importers: Record<string, any>;
  packages: Record<string, any>;
};

export async function parsePnpmLock(file: string): Promise<PNPMDoc> {
  await fsp.access(file);
  const yq = ensureNixStoreToolPathSync("yq");
  try {
    const { stdout } = await execFileAsync(yq, [".", file], {
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout) as PNPMDoc;
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr || "").trim()
        : "";
    const detail = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`failed to parse pnpm lockfile with Nix yq: ${file}: ${detail}`, {
      cause: error,
    });
  }
}

export function buildPnpmGraph(doc: PNPMDoc) {
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

// Compute the effective set of "<name>@<version>" for a given importer,
// including peer resolution edges when a package both declares a peer
// and lists a resolved host in its dependencies.
export function effectiveSetForImporter(doc: PNPMDoc, importer: string): Set<string> {
  const nodes = buildPnpmGraph(doc);
  const out = new Set<string>();
  const imp = (doc.importers as any)?.[importer] || {};
  const roots = new Set<string>();
  const addRoot = (depName: string, depRef: any) => {
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
    // include peer resolution edges if the package declares peers AND resolved hosts are present in its dependencies
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
