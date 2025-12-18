#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { Node } from "../types.ts";
import { packageDirFromTargetName } from "../batch.ts";
import { inspectLockfileLabel } from "../../../lib/labels.ts";
import { computeImporterLabel } from "../../../lib/importers.ts";

function labelsOf(n: Node): string[] {
  return Array.isArray(n.labels) ? n.labels : [];
}

export function lockfileLabels(n: Node): string[] {
  return labelsOf(n).filter((l) => typeof l === "string" && l.startsWith("lockfile:"));
}

export function hasKindLabel(n: Node): boolean {
  return labelsOf(n).some((l) => typeof l === "string" && l.startsWith("kind:"));
}

function stableSortedDedupedLabels(labels: string[]): string[] {
  return Array.from(new Set(labels)).sort();
}

export type ValidateImporterLockfileLabelsOptions = {
  adapterName: string;
  node: Node;
};

export function validateImporterLockfileLabels(
  opts: ValidateImporterLockfileLabelsOptions,
): string[] {
  const { adapterName, node } = opts;
  const locks = lockfileLabels(node);
  if (locks.length === 0) return [];

  const findings: string[] = [];
  if (locks.length > 1) {
    findings.push(
      [
        `[exporter][${adapterName}] multiple importer-scoped lockfile labels on ${node.name}:`,
        `  - ${locks.join("\n  - ")}`,
        `Fix: keep exactly one importer label of the form lockfile:<path>#<importer>.`,
      ].join("\n"),
    );
  }

  const first = locks[0];
  const inspected = inspectLockfileLabel(first);
  if (inspected.kind === "malformed") {
    findings.push(
      [
        `[exporter][${adapterName}] malformed lockfile label on ${node.name}: '${first}'.`,
        `Expected: lockfile:<path>#<importer> (example: lockfile:apps/web/pnpm-lock.yaml#apps/web).`,
      ].join("\n"),
    );
    return findings;
  }
  if (inspected.kind === "invalid-importer") {
    findings.push(
      [
        `[exporter][${adapterName}] lockfile importer mismatch on ${node.name}: '${first}'.`,
        `Fix: set importer to '${inspected.expectedImporter}' to match the lockfile directory. Use importer '.' only for repo-root lockfiles (example: lockfile:pnpm-lock.yaml#.).`,
      ].join("\n"),
    );
  }

  return findings;
}

export type AttachImporterLockfileLabelsOptions = {
  nodes: Node[];
  isTarget(node: Node): boolean;
  findNearestLockfile(pkgDir: string): Promise<string | null>;
};

export async function attachImporterLockfileLabelsIfMacroStamped(
  opts: AttachImporterLockfileLabelsOptions,
): Promise<Node[]> {
  const { nodes, isTarget, findNearestLockfile } = opts;
  const lockByPkg = new Map<string, Promise<string | null>>();
  const nearestLock = (pkgDir: string) => {
    const key = pkgDir || ".";
    const cur = lockByPkg.get(key);
    if (cur) return cur;
    const next = findNearestLockfile(key);
    lockByPkg.set(key, next);
    return next;
  };

  const out: Node[] = [];
  for (const n of nodes) {
    if (!isTarget(n)) {
      out.push(n);
      continue;
    }

    const labs = labelsOf(n);
    if (!hasKindLabel(n) || lockfileLabels(n).length > 0) {
      out.push(n);
      continue;
    }

    const pkgDir = packageDirFromTargetName(n.name || "") || ".";
    const lockRel = await nearestLock(pkgDir);
    if (!lockRel) {
      out.push(n);
      continue;
    }

    const importer = computeImporterLabel(lockRel);
    const label = `lockfile:${lockRel}#${importer}`;
    const next = stableSortedDedupedLabels([...labs, label]);
    out.push({ ...n, labels: next });
  }

  return out;
}
