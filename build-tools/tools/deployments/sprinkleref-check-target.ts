#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "zx";
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes";
import { normalizeTargetLabel } from "../lib/labels";
import type { GraphNode } from "../lib/graph";
import { deploymentBuckEnv, deploymentIsolationArgs } from "./deployment-query-helpers";
import { readDeploymentRequirements } from "./deployment-requirements";
import type { SprinkleRefDepsMode, SprinkleRefScope } from "./sprinkleref-check-types";

const ATTRS = ["name", "component", "secret_requirements", "runtime_config_requirements"];

export type TargetRef = {
  ref: string;
  source: string;
  requiredBy: string;
  scope: SprinkleRefScope;
  locations: string[];
};

export async function collectTargetRefs(opts: {
  target: string;
  deps: SprinkleRefDepsMode;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<TargetRef[]> {
  const target = normalizeTargetLabel(opts.target);
  const cwd = opts.cwd || process.cwd();
  const nodes = await queryTargetNodes(target, opts.deps, cwd, opts.env);
  const direct = directLabels(target, nodes);
  const refs = await Promise.all(
    nodes.flatMap((node) => refsFromNode(node, direct)).map((entry) => locateTargetRef(cwd, entry)),
  );
  if (refs.length === 0) {
    throw new Error(`target ${target} did not expose structured SprinkleRef requirement metadata`);
  }
  return refs.sort(
    (a, b) => a.ref.localeCompare(b.ref) || a.requiredBy.localeCompare(b.requiredBy),
  );
}

async function queryTargetNodes(
  target: string,
  deps: SprinkleRefDepsMode,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<GraphNode[]> {
  const expr = queryExpression(target, deps);
  const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const buckEnv = deploymentBuckEnv(cwd, env);
  const result = await $({
    cwd,
    stdio: "pipe",
    env: buckEnv,
  })`buck2 ${deploymentIsolationArgs(buckEnv)} cquery --target-platforms prelude//platforms:default ${expr} --json ${attrFlags}`.quiet();
  const nodes = nodesFromCqueryJson(
    JSON.parse(String(result.stdout || "{}")) as Record<string, unknown>,
  );
  if (!isAppTarget(target)) return nodes;
  const deployments = await queryDeploymentRdeps(target, cwd, buckEnv);
  return uniqueNodes([...nodes, ...deployments]);
}

function queryExpression(target: string, deps: SprinkleRefDepsMode): string {
  if (deps === "none") return target;
  if (deps === "direct") return `deps(${target}, 1)`;
  return `deps(${target})`;
}

async function queryDeploymentRdeps(
  target: string,
  cwd: string,
  buckEnv: NodeJS.ProcessEnv,
): Promise<GraphNode[]> {
  const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const result = await $({
    cwd,
    stdio: "pipe",
    env: buckEnv,
  })`buck2 ${deploymentIsolationArgs(buckEnv)} cquery --target-platforms prelude//platforms:default ${`rdeps(//projects/deployments/..., ${target})`} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(result.stdout || "{}")) as Record<string, unknown>);
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  return [...new Map(nodes.map((node) => [String(node.name || ""), node])).values()];
}

function directLabels(target: string, nodes: GraphNode[]): Set<string> {
  if (!isAppTarget(target)) return new Set([target]);
  return new Set(
    nodes
      .filter((node) => normalizeTargetLabel(String(node.component || "")) === target)
      .map((node) => normalizeTargetLabel(String(node.name || ""))),
  );
}

function isAppTarget(target: string): boolean {
  return target.startsWith("//projects/apps/");
}

function refsFromNode(node: GraphNode, direct: Set<string>): TargetRef[] {
  const label = normalizeTargetLabel(String(node.name || ""));
  const scope: SprinkleRefScope = direct.has(label) ? "direct" : "dependency";
  return [
    ...readDeploymentRequirements(node, "secret_requirements").map((requirement) => ({
      ref: requirement.contractId,
      source: requirement.source || "secret_requirements",
      requiredBy: label,
      scope,
      locations: [],
    })),
    ...readDeploymentRequirements(node, "runtime_config_requirements").map((requirement) => ({
      ref: requirement.contractId,
      source: requirement.source || "runtime_config_requirements",
      requiredBy: label,
      scope,
      locations: [],
    })),
  ].filter((entry) => /^(secret|config|runtime):\/\//.test(entry.ref));
}

async function locateTargetRef(cwd: string, entry: TargetRef): Promise<TargetRef> {
  const literalLocations = [
    ...(await findLiteralLocations(cwd, packagePath(entry.requiredBy), entry.ref)),
    ...(await findLiteralLocations(cwd, "", entry.ref)),
  ];
  const uniqueLocations = [...new Set(literalLocations)];
  return {
    ...entry,
    locations:
      uniqueLocations.length > 0 ? uniqueLocations : [`buck://${entry.requiredBy}#${entry.source}`],
  };
}

async function findLiteralLocations(cwd: string, dir: string, ref: string): Promise<string[]> {
  const roots = dir
    ? [dir]
    : ["projects/deployments", "projects/apps", "build-tools/deployments"].filter(Boolean);
  const files = (
    await Promise.all(roots.map((root) => listTextFiles(cwd, path.join(cwd, root))))
  ).flat();
  const locations: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(cwd, file), "utf8").catch(() => "");
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(ref)) locations.push(`${file}:${index + 1}`);
    });
  }
  return locations;
}

async function listTextFiles(root: string, dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listTextFiles(root, full)));
    else if (/\.(bzl|json|jsonc|toml|txt)$/.test(entry.name) || entry.name === "TARGETS") {
      files.push(path.relative(root, full));
    }
  }
  return files;
}

function packagePath(target: string): string {
  const match = target.match(/^\/\/([^:]+):/);
  return match ? match[1] : "";
}
