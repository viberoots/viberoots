#!/usr/bin/env zx-wrapper
import { ensureGraph } from "../buck/glue-run";
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes";
import { normalizeTargetLabel } from "../lib/labels";
import { componentTargetsFor, extractDeployments, type DeploymentTarget } from "./contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "./deployment-query-attrs";
import {
  deploymentBuckEnv,
  deploymentIsolationArgs,
  normalizeQueryTarget,
  queryComponentLabels,
  queryLabelList,
} from "./deployment-query-helpers";

const DEPLOYMENT_GRAPH_QUERY_ROOTS = ["projects/deployments", "projects/apps", "projects/libs"];

function relatedLabelsForNodes(
  nodes: ReturnType<typeof nodesFromCqueryJson>,
  excluded: string[],
): string[] {
  const blocked = new Set(excluded.map((label) => normalizeTargetLabel(label)));
  return Array.from(
    new Set(
      nodes.flatMap((node) =>
        [
          normalizeTargetLabel(String((node as any).component || "")),
          ...queryComponentLabels(node as Record<string, unknown>),
          normalizeTargetLabel(String((node as any).lane_policy || "")),
          normalizeTargetLabel(String((node as any).governance_policy || "")),
          normalizeTargetLabel(String((node as any).defaults || "")),
          normalizeTargetLabel(String((node as any).admission_policy || "")),
          normalizeTargetLabel(String((node as any).migration_bundle || "")),
          ...queryLabelList(node as Record<string, unknown>, "release_actions"),
          ...queryLabelList(node as Record<string, unknown>, "target_exceptions"),
        ].filter((label) => label && !blocked.has(label)),
      ),
    ),
  );
}

async function queryDeploymentNodesExpanded(
  workspaceRoot: string,
  labels: string[],
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<ReturnType<typeof nodesFromCqueryJson>> {
  const allLabels = Array.from(new Set(labels.map((label) => normalizeTargetLabel(label))));
  while (true) {
    const nodes = await queryDeploymentNodes(workspaceRoot, allLabels, opts);
    const extraLabels = relatedLabelsForNodes(nodes, allLabels);
    if (extraLabels.length === 0) return nodes;
    allLabels.push(...extraLabels);
  }
}

export async function queryDeploymentNodes(
  workspaceRoot: string,
  labels: string[],
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<ReturnType<typeof nodesFromCqueryJson>> {
  return queryDeploymentNodesWithAttrs(workspaceRoot, labels, DEPLOYMENT_CQUERY_ATTRS, opts);
}

export async function queryDeploymentNodesWithAttrs(
  workspaceRoot: string,
  labels: string[],
  attrs: string[],
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<ReturnType<typeof nodesFromCqueryJson>> {
  const normalizedLabels = Array.from(new Set(labels.map((label) => normalizeTargetLabel(label))));
  await ensureGraph({
    workspaceRoot,
    queryRoots: DEPLOYMENT_GRAPH_QUERY_ROOTS,
  });
  const attrFlags = Array.from(new Set(attrs)).flatMap((attr) => ["--output-attribute", attr]);
  const query = `set(${normalizedLabels.join(" ")})`;
  const buckEnv = deploymentBuckEnv(workspaceRoot, opts?.env);
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: buckEnv,
  })`buck2 ${deploymentIsolationArgs(buckEnv)} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(stdout || "{}")) as Record<string, any>);
}

export async function resolveDeploymentFromTarget(
  workspaceRoot: string,
  deploymentTarget: string,
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<DeploymentTarget> {
  const initialNodes = await queryDeploymentNodes(workspaceRoot, [deploymentTarget], opts);
  const deploymentNode = initialNodes.find((node) => node.name === deploymentTarget);
  if (!deploymentNode) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const extraLabels = [
    normalizeTargetLabel(String((deploymentNode as any).component || "")),
    ...queryComponentLabels(deploymentNode as Record<string, unknown>),
    normalizeTargetLabel(String((deploymentNode as any).lane_policy || "")),
    normalizeTargetLabel(String((deploymentNode as any).governance_policy || "")),
    normalizeTargetLabel(String((deploymentNode as any).admission_policy || "")),
    normalizeTargetLabel(String((deploymentNode as any).migration_bundle || "")),
    ...queryLabelList(deploymentNode as Record<string, unknown>, "release_actions"),
    ...queryLabelList(deploymentNode as Record<string, unknown>, "target_exceptions"),
  ].filter((label) => label && label !== deploymentTarget);
  const nodes =
    extraLabels.length > 0
      ? await queryDeploymentNodesExpanded(workspaceRoot, [deploymentTarget, ...extraLabels], opts)
      : initialNodes;
  try {
    return await resolveDeploymentFromNodes(
      workspaceRoot,
      deploymentTarget,
      nodes,
      extraLabels,
      opts,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (
      !message.includes('unknown prerequisite deployment_id "') &&
      !message.includes(": component target ") &&
      !message.includes(" does not exist")
    ) {
      throw error;
    }
    const allDeployments = await resolveAllDeployments(workspaceRoot);
    const hit = allDeployments.find((deployment) => deployment.label === deploymentTarget);
    if (!hit) throw error;
    return hit;
  }
}

async function resolveDeploymentFromNodes(
  workspaceRoot: string,
  deploymentTarget: string,
  nodes: ReturnType<typeof nodesFromCqueryJson>,
  extraLabels: string[],
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<DeploymentTarget> {
  const extracted = extractDeployments(nodes, { workspaceRoot });
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const hit = extracted.deployments.find((deployment) => deployment.label === deploymentTarget);
  if (!hit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const componentLabels = componentTargetsFor(hit).filter(
    (label) => label && ![deploymentTarget, ...extraLabels].includes(label),
  );
  if (componentLabels.length === 0) return hit;
  const expanded = extractDeployments(
    await queryDeploymentNodes(
      workspaceRoot,
      [deploymentTarget, ...extraLabels, ...componentLabels],
      opts,
    ),
    { workspaceRoot },
  );
  if (expanded.errors.length > 0) throw new Error(expanded.errors.join("\n"));
  const expandedHit = expanded.deployments.find(
    (deployment) => deployment.label === deploymentTarget,
  );
  if (!expandedHit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return expandedHit;
}

export async function listDeploymentTargets(workspaceRoot: string): Promise<string[]> {
  await ensureGraph({ workspaceRoot, queryRoots: DEPLOYMENT_GRAPH_QUERY_ROOTS });
  const query = 'kind("deployment_target", //...)';
  const buckEnv = deploymentBuckEnv(workspaceRoot);
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: buckEnv,
  })`buck2 ${deploymentIsolationArgs(buckEnv)} cquery --target-platforms prelude//platforms:default ${query} --json --output-attribute name`.quiet();
  const raw = JSON.parse(String(stdout || "{}")) as Record<string, unknown>;
  return Object.keys(raw)
    .map((target) => normalizeQueryTarget(target))
    .filter(Boolean)
    .sort();
}

export async function resolveAllDeployments(workspaceRoot: string): Promise<DeploymentTarget[]> {
  const labels = await listDeploymentTargets(workspaceRoot);
  if (labels.length === 0) return [];
  const nodes = await queryDeploymentNodes(workspaceRoot, labels);
  const extraLabels = relatedLabelsForNodes(nodes, labels);
  const allNodes =
    extraLabels.length > 0
      ? await queryDeploymentNodesExpanded(workspaceRoot, [...labels, ...extraLabels])
      : nodes;
  const extracted = extractDeployments(allNodes, { workspaceRoot });
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const componentLabels = Array.from(
    new Set(extracted.deployments.flatMap((deployment) => componentTargetsFor(deployment))),
  ).filter((label) => label && !labels.includes(label) && !extraLabels.includes(label));
  if (componentLabels.length === 0) return extracted.deployments;
  const expanded = extractDeployments(
    await queryDeploymentNodes(workspaceRoot, [...labels, ...extraLabels, ...componentLabels]),
    { workspaceRoot },
  );
  if (expanded.errors.length > 0) throw new Error(expanded.errors.join("\n"));
  return expanded.deployments;
}
