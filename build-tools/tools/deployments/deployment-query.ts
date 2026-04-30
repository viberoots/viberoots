#!/usr/bin/env zx-wrapper
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { componentTargetsFor, extractDeployments, type DeploymentTarget } from "./contract.ts";
import {
  deploymentBuckEnv,
  deploymentIsolationArgs,
  normalizeQueryTarget,
  queryComponentLabels,
  queryLabelList,
} from "./deployment-query-helpers.ts";

const DEPLOYMENT_CQUERY_ATTRS = [
  "name",
  "rule_type",
  "buck.type",
  "provider",
  "component",
  "component_kind",
  "components",
  "publisher",
  "publisher_config",
  "provisioner",
  "provisioner_config",
  "protection_class",
  "lane_policy",
  "environment_stage",
  "admission_policy",
  "rollout_policy",
  "rollout_steps",
  "app_name",
  "container_port",
  "health_path",
  "target_group",
  "provider_target",
  "vault_runtime",
  "smoke",
  "smoke_exception",
  "smoke_runner_class",
  "smoke_timeout_budget_ms",
  "preview",
  "prerequisites",
  "secret_requirements",
  "runtime_config_requirements",
  "release_actions",
  "target_exceptions",
  "type",
  "phase",
  "run_condition",
  "abort_behavior",
  "data_compatibility",
  "replay_policy",
  "duplicate_safety",
  "operation_keys",
  "required_secret_requirements",
  "required_runtime_config_requirements",
  "exception_id",
  "exception_kind",
  "affected_deployments",
  "old_provider_target_identity",
  "new_provider_target_identity",
  "shared_lock_scope",
  "approval_evidence",
  "effective_at",
  "expires_at",
  "completion_signal",
  "reconciliation_owner",
  "governance_policy",
  "defaults",
  "default_client_profile",
  "scm_backend",
  "repository",
  "branch_protections",
  "stages",
  "stage_branches",
  "allowed_promotion_edges",
  "artifact_reuse_mode",
  "promotion_compatibility",
  "allowed_refs",
  "required_checks",
  "required_approvals",
  "retry_branch_policy",
  "retry_approval_reuse",
  "artifact_attestation_mode",
  "labels",
];

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
  const normalizedLabels = Array.from(new Set(labels.map((label) => normalizeTargetLabel(label))));
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `set(${normalizedLabels.join(" ")})`;
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: deploymentBuckEnv(opts?.env),
  })`buck2 ${deploymentIsolationArgs(opts?.env)} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
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
  const extracted = extractDeployments(nodes);
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
  );
  if (expanded.errors.length > 0) throw new Error(expanded.errors.join("\n"));
  const expandedHit = expanded.deployments.find(
    (deployment) => deployment.label === deploymentTarget,
  );
  if (!expandedHit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return expandedHit;
}

export async function listDeploymentTargets(workspaceRoot: string): Promise<string[]> {
  const query = 'kind("deployment_target", //...)';
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: deploymentBuckEnv(),
  })`buck2 ${deploymentIsolationArgs()} cquery --target-platforms prelude//platforms:default ${query} --json --output-attribute name`.quiet();
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
  const extracted = extractDeployments(allNodes);
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const componentLabels = Array.from(
    new Set(extracted.deployments.flatMap((deployment) => componentTargetsFor(deployment))),
  ).filter((label) => label && !labels.includes(label) && !extraLabels.includes(label));
  if (componentLabels.length === 0) return extracted.deployments;
  const expanded = extractDeployments(
    await queryDeploymentNodes(workspaceRoot, [...labels, ...extraLabels, ...componentLabels]),
  );
  if (expanded.errors.length > 0) throw new Error(expanded.errors.join("\n"));
  return expanded.deployments;
}
