#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { readCompositeGraph } from "../lib/graph-view.ts";
import { parseLockfileLabel, normalizeTargetLabel } from "../lib/labels.ts";
import { isWorkspaceImporterPath } from "../lib/importers.ts";
import { writeIfChanged } from "../lib/fs-helpers.ts";
import { repoRoot } from "../lib/repo.ts";
import { collectDeps, listImporters } from "../lib/node-deps-enforcement-core.ts";

type GraphNode = { name?: string; labels?: string[]; rule_type?: string };

type ImporterTargets = {
  importer: string;
  targets: string[];
};

async function readJsonFile<T>(filePath: string): Promise<T> {
  const txt = await fsp.readFile(filePath, "utf8");
  return JSON.parse(txt) as T;
}

function packageBase(importer: string): string {
  const parts = importer.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : importer;
}

function targetNameFromLabel(label: string): string {
  const normalized = normalizeTargetLabel(label);
  const idx = normalized.indexOf(":");
  if (idx < 0) return "";
  const name = normalized.slice(idx + 1);
  const hashIdx = name.indexOf("#");
  return hashIdx >= 0 ? name.slice(0, hashIdx) : name;
}

function labelsForTarget(nodesByTarget: Map<string, GraphNode>, target: string): string[] {
  const node = nodesByTarget.get(normalizeTargetLabel(target));
  return Array.isArray(node?.labels) ? (node?.labels as string[]) : [];
}

function ruleTypeForTarget(nodesByTarget: Map<string, GraphNode>, target: string): string {
  const node = nodesByTarget.get(normalizeTargetLabel(target));
  return String(node?.rule_type || "");
}

function pickTargetForImporter(
  importer: string,
  targets: string[],
  nodesByTarget: Map<string, GraphNode>,
): string | null {
  const normalizedTargets = targets.map((t) => normalizeTargetLabel(t));
  const expected = `//${importer}:${packageBase(importer)}`;
  if (normalizedTargets.includes(expected)) return expected;
  const preferredNames = ["app", "lib", "bin"];
  for (const name of preferredNames) {
    const direct = normalizeTargetLabel(`//${importer}:${name}`);
    if (normalizedTargets.includes(direct)) return direct;
    const matches = normalizedTargets.filter((t) => targetNameFromLabel(t) === name);
    if (matches.length === 1) return matches[0] || null;
  }
  if (normalizedTargets.length === 1) return normalizedTargets[0] || null;
  const preferredKinds = ["lib", "app", "bin"];
  for (const kind of preferredKinds) {
    const match = normalizedTargets.filter((t) =>
      labelsForTarget(nodesByTarget, t).includes(`kind:${kind}`),
    );
    if (match.length === 1) return match[0] || null;
  }
  const nonTestNames = normalizedTargets.filter((t) => !/:(unit|test)$/i.test(t));
  if (nonTestNames.length === 1) return nonTestNames[0] || null;
  const nonTests = normalizedTargets.filter(
    (t) => !/test/i.test(ruleTypeForTarget(nodesByTarget, t)),
  );
  if (nonTests.length === 1) return nonTests[0] || null;
  return null;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const graphPath = getFlagStr("graph", "");
  const nodeLockIndexPath = getFlagStr("node-lock-index", "");
  const outPath = getFlagStr(
    "out",
    path.join(root, "build-tools", "tools", "node", "workspace-map.json"),
  );
  let comp: any;
  try {
    comp = await readCompositeGraph({
      graphPath: graphPath || undefined,
      nodeLockIndexPath: nodeLockIndexPath || undefined,
    });
  } catch (e) {
    throw new Error(`workspace-map generation requires a valid Buck graph: ${String(e)}`);
  }
  const nodes = Array.isArray(comp?.nodes) ? (comp.nodes as GraphNode[]) : [];
  const nodeLockIndex = (comp?.nodeLockIndex || {}) as Record<string, string>;
  const nodesByTarget = new Map<string, GraphNode>();
  for (const n of nodes) {
    const name = String(n?.name || "");
    if (!name) continue;
    const key = normalizeTargetLabel(name);
    if (!nodesByTarget.has(key)) nodesByTarget.set(key, n);
  }
  const importerTargets: ImporterTargets[] = [];
  for (const [target, label] of Object.entries(nodeLockIndex || {})) {
    const parsed = parseLockfileLabel(String(label || ""));
    if (!parsed) continue;
    if (!isWorkspaceImporterPath(parsed.importer)) continue;
    const key = parsed.importer;
    const existing = importerTargets.find((i) => i.importer === key);
    if (existing) {
      existing.targets.push(normalizeTargetLabel(target));
    } else {
      importerTargets.push({ importer: key, targets: [normalizeTargetLabel(target)] });
    }
  }
  importerTargets.sort((a, b) => a.importer.localeCompare(b.importer));
  for (const entry of importerTargets) {
    entry.targets = Array.from(new Set(entry.targets)).sort((a, b) => a.localeCompare(b));
  }

  const importers = await listImporters(root);
  const importerSet = new Set(importers);
  const mapping: Record<string, string> = {};
  const errors: string[] = [];
  for (const entry of importerTargets) {
    // Graph snapshots can temporarily contain stale importer lockfile labels.
    // Only map importers that actually exist in the current workspace tree.
    if (!importerSet.has(entry.importer)) continue;
    const pkgPath = path.join(root, entry.importer, "package.json");
    let pkg: any;
    try {
      pkg = await readJsonFile<any>(pkgPath);
    } catch (e) {
      errors.push(`missing or unreadable ${entry.importer}/package.json: ${String(e)}`);
      continue;
    }
    const pkgName = String(pkg?.name || "").trim();
    if (!pkgName) {
      errors.push(`missing package.json name in ${entry.importer}/package.json`);
      continue;
    }
    const target = pickTargetForImporter(entry.importer, entry.targets, nodesByTarget);
    if (!target) {
      errors.push(
        `cannot choose target for ${entry.importer} (candidates: ${entry.targets.join(", ")})`,
      );
      continue;
    }
    if (mapping[pkgName] && mapping[pkgName] !== target) {
      errors.push(`duplicate package name ${pkgName} maps to ${mapping[pkgName]} and ${target}`);
      continue;
    }
    mapping[pkgName] = target;
  }

  const missingDeps: string[] = [];
  for (const importer of importers) {
    const pkgPath = path.join(root, importer, "package.json");
    let pkg: any = {};
    try {
      pkg = await readJsonFile(pkgPath);
    } catch {
      continue;
    }
    for (const dep of collectDeps(pkg)) {
      if (dep.spec.trim().startsWith("workspace:") && !mapping[dep.name]) {
        missingDeps.push(`${importer}:${dep.name}`);
      }
    }
  }
  if (missingDeps.length > 0) {
    for (const miss of missingDeps.sort((a, b) => a.localeCompare(b))) {
      const [importer, name] = miss.split(":");
      errors.push(
        `workspace dependency ${name} used by ${importer}/package.json has no workspace map entry`,
      );
    }
  }
  if (errors.length > 0) {
    for (const msg of errors) console.error(`ERROR: ${msg}`);
    process.exit(1);
  }
  const ordered: Record<string, string> = {};
  for (const k of Object.keys(mapping).sort((a, b) => a.localeCompare(b))) {
    ordered[k] = mapping[k];
  }
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await writeIfChanged(outPath, JSON.stringify(ordered, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
