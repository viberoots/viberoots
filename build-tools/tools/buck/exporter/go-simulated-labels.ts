#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readOrBuildSimulatedBatchCache } from "./go-simulated-cache.ts";
import type { Batch, Node } from "./types.ts";

type GoModuleContract = {
  modulePath: string;
  requires: Map<string, string>;
  replaces: Map<string, { replacement: string; version: string }>;
};

const goModuleContracts = new Map<string, Promise<GoModuleContract>>();

async function readGoModuleContract(moduleRoot: string): Promise<GoModuleContract> {
  let pending = goModuleContracts.get(moduleRoot);
  if (!pending) {
    pending = (async () => {
      const goModPath = path.join(process.cwd(), moduleRoot, "go.mod");
      const raw = await fsp.readFile(goModPath, "utf8");
      return parseGoModuleContract(raw);
    })();
    goModuleContracts.set(moduleRoot, pending);
  }
  return await pending;
}

function parseGoModuleContract(raw: string): GoModuleContract {
  return {
    modulePath: captureDirectiveValue(raw, "module"),
    requires: parseModuleEntries(raw, "require"),
    replaces: parseReplaceEntries(raw),
  };
}

function captureDirectiveValue(raw: string, directive: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripLineComment(line).trim();
    if (!trimmed.startsWith(`${directive} `)) continue;
    return trimmed.slice(directive.length).trim();
  }
  return "";
}

function parseModuleEntries(raw: string, directive: string): Map<string, string> {
  const entries = new Map<string, string>();
  let inBlock = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripLineComment(line).trim();
    if (!trimmed) continue;
    if (trimmed === `${directive} (`) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ")") {
      inBlock = false;
      continue;
    }
    const content = inBlock
      ? trimmed
      : trimmed.startsWith(`${directive} `)
        ? trimmed.slice(directive.length).trim()
        : "";
    if (!content) continue;
    const parts = content.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) entries.set(parts[0] || "", parts[1] || "");
  }
  return entries;
}

function parseReplaceEntries(raw: string): Map<string, { replacement: string; version: string }> {
  const entries = new Map<string, { replacement: string; version: string }>();
  let inBlock = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripLineComment(line).trim();
    if (!trimmed) continue;
    if (trimmed === "replace (") {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ")") {
      inBlock = false;
      continue;
    }
    const content = inBlock
      ? trimmed
      : trimmed.startsWith("replace ")
        ? trimmed.slice("replace".length).trim()
        : "";
    if (!content) continue;
    const [lhsRaw, rhsRaw] = content.split(/\s+=>\s+/);
    if (!lhsRaw || !rhsRaw) continue;
    const lhsParts = lhsRaw.split(/\s+/).filter(Boolean);
    const rhsParts = rhsRaw.split(/\s+/).filter(Boolean);
    const modulePath = lhsParts[0] || "";
    if (!modulePath) continue;
    entries.set(modulePath, {
      replacement: rhsParts[0] || "",
      version: rhsParts[1] || "",
    });
  }
  return entries;
}

function stripLineComment(line: string): string {
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function collectImports(source: string): string[] {
  const imports = new Set<string>();
  for (const match of source.matchAll(
    /^\s*import\s+(?:[A-Za-z_][\w.]*\s+|\.?\s*)?"([^"]+)"\s*$/gm,
  )) {
    const spec = match[1]?.trim();
    if (spec) imports.add(spec);
  }
  for (const match of source.matchAll(/^\s*import\s*\(([\s\S]*?)^\s*\)/gm)) {
    for (const quoted of (match[1] || "").matchAll(/"([^"]+)"/g)) {
      const spec = quoted[1]?.trim();
      if (spec) imports.add(spec);
    }
  }
  return Array.from(imports);
}

function longestKnownModulePrefix(
  importPath: string,
  contract: GoModuleContract,
): { modulePath: string; version: string } | null {
  let best = "";
  for (const candidate of new Set([...contract.requires.keys(), ...contract.replaces.keys()])) {
    if (!candidate) continue;
    if (importPath !== candidate && !importPath.startsWith(`${candidate}/`)) continue;
    if (candidate.length > best.length) best = candidate;
  }
  if (!best) return null;
  const replaced = contract.replaces.get(best);
  return {
    modulePath: best,
    version: replaced?.version || contract.requires.get(best) || "unknown",
  };
}

async function labelsForNodeInBatch(node: Node, batch: Batch): Promise<string[]> {
  const contract = await readGoModuleContract(batch.cwd);
  const moduleLabels = new Set<string>();
  for (const relSrc of Array.isArray(node.srcs) ? node.srcs : []) {
    if (!relSrc.endsWith(".go")) continue;
    const source = await fsp
      .readFile(resolveNodeSourcePathForTarget(node.name, relSrc), "utf8")
      .catch(() => "");
    for (const spec of collectImports(source)) {
      const first = spec.split("/")[0] || "";
      if (!first.includes(".")) continue;
      const match = longestKnownModulePrefix(spec, contract);
      if (match) moduleLabels.add(`module:${match.modulePath}@${match.version}`.toLowerCase());
    }
  }
  return Array.from(moduleLabels).sort();
}

function resolveNodeSourcePathForTarget(targetName: string, src: string): string {
  if (src.startsWith("/") || src.startsWith("./") || src.startsWith("../")) {
    return path.resolve(process.cwd(), src);
  }
  const pkgDir = targetName.match(/^\/\/(.+):[^:]+$/)?.[1] || ".";
  const pkgRelative = path.resolve(process.cwd(), pkgDir, src);
  const repoRelative = path.resolve(process.cwd(), src);
  return path.relative(process.cwd(), src).startsWith(pkgDir) ? repoRelative : pkgRelative;
}

export async function attachSimulatedGoModuleLabels(
  nodes: Node[],
  batches: Batch[],
  cacheDir: string,
): Promise<Node[]> {
  if (batches.length === 0) return nodes;
  const labelsByTarget = new Map<string, string[]>();
  for (const batch of batches) {
    const labelsForBatch = await readOrBuildSimulatedBatchCache(
      batch,
      cacheDir,
      resolveNodeSourcePathForTarget,
      async () => {
        const labels = new Map<string, string[]>();
        for (const node of batch.members)
          labels.set(node.name, await labelsForNodeInBatch(node, batch));
        return labels;
      },
    );
    for (const [target, labels] of labelsForBatch) labelsByTarget.set(target, labels);
  }
  return nodes.map((node) => {
    const keep = (node.labels || []).filter((label) => !label.startsWith("module:"));
    return { ...node, labels: [...keep, ...(labelsByTarget.get(node.name) || [])] };
  });
}
