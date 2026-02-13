#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { GraphNode } from "./graph.ts";
import { normalizeTargetLabel } from "./labels.ts";
import { defaultImporterPatchDir, listImporterPatches } from "./importers.ts";
import { decodeNameVersionFromPatch, encodeForPatchFilename } from "./providers.ts";

const REQUIRED_PREFIX = "node_patch_required:";
const OPTIONAL_PREFIX = "node_patch_optional:";

export type ImporterRequirementReport = {
  importer: string;
  requirementsRequired: string[];
  requirementsOptional: string[];
  importerPatchIds: string[];
  missingRequired: string[];
  missingOptional: string[];
};

function parseRequirementLabels(labels: string[] | undefined): {
  required: Set<string>;
  optional: Set<string>;
} {
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const raw of labels || []) {
    const label = String(raw || "").trim();
    if (label.startsWith(REQUIRED_PREFIX)) {
      const id = label.slice(REQUIRED_PREFIX.length).trim().toLowerCase();
      if (id) required.add(id);
      continue;
    }
    if (label.startsWith(OPTIONAL_PREFIX)) {
      const id = label.slice(OPTIONAL_PREFIX.length).trim().toLowerCase();
      if (id) optional.add(id);
    }
  }
  for (const id of optional) required.delete(id);
  return { required, optional };
}

function sortIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

function buildNodeIndex(nodes: GraphNode[]): Map<string, GraphNode> {
  const byName = new Map<string, GraphNode>();
  for (const node of nodes) {
    const name = normalizeTargetLabel(String(node.name || "").trim());
    if (!name.startsWith("//")) continue;
    byName.set(name, node);
  }
  return byName;
}

function depLabels(node: GraphNode): string[] {
  if (!Array.isArray(node.deps)) return [];
  const out: string[] = [];
  for (const raw of node.deps as unknown[]) {
    const n = normalizeTargetLabel(String(raw || "").trim());
    if (n.startsWith("//")) out.push(n);
  }
  return out;
}

export function requirementClosureForImporter(
  nodes: GraphNode[],
  importer: string,
): { required: string[]; optional: string[] } {
  const importerPrefix = `//${importer}:`;
  const byName = buildNodeIndex(nodes);
  const roots = Array.from(byName.keys()).filter((k) => k.startsWith(importerPrefix));
  const visit = [...roots];
  const seen = new Set<string>();
  const required = new Set<string>();
  const optional = new Set<string>();
  while (visit.length > 0) {
    const cur = visit.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byName.get(cur);
    if (!node) continue;
    const parsed = parseRequirementLabels(node.labels);
    for (const id of parsed.required) required.add(id);
    for (const id of parsed.optional) optional.add(id);
    for (const dep of depLabels(node)) {
      if (!seen.has(dep)) visit.push(dep);
    }
  }
  for (const id of optional) required.delete(id);
  return { required: sortIds(required), optional: sortIds(optional) };
}

export async function importerPatchIds(importer: string): Promise<string[]> {
  const rels = await listImporterPatches(importer, "node");
  const out = new Set<string>();
  for (const rel of rels) {
    const decoded = decodeNameVersionFromPatch(path.posix.basename(rel));
    if (!decoded) continue;
    out.add(decoded);
  }
  return sortIds(out);
}

export async function buildImporterRequirementReport(
  nodes: GraphNode[],
  importer: string,
): Promise<ImporterRequirementReport> {
  const closure = requirementClosureForImporter(nodes, importer);
  const patches = await importerPatchIds(importer);
  const patchSet = new Set(patches);
  const missingRequired = closure.required.filter((id) => !patchSet.has(id));
  const missingOptional = closure.optional.filter((id) => !patchSet.has(id));
  return {
    importer,
    requirementsRequired: closure.required,
    requirementsOptional: closure.optional,
    importerPatchIds: patches,
    missingRequired,
    missingOptional,
  };
}

export function remediationCommand(importer: string): string {
  return `patch-pkg sync-required node --importer ${importer}`;
}

export function patchFilenameForId(id: string): string | null {
  const norm = String(id || "")
    .trim()
    .toLowerCase();
  const at = norm.lastIndexOf("@");
  if (at <= 0 || at >= norm.length - 1) return null;
  const name = norm.slice(0, at);
  const version = norm.slice(at + 1);
  return `${encodeForPatchFilename(name)}@${version}.patch`;
}

export function importerPatchDir(importer: string): string {
  return defaultImporterPatchDir(importer, "node");
}
