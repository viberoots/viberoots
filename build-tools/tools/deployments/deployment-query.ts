#!/usr/bin/env zx-wrapper
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { componentTargetsFor, extractDeployments, type DeploymentTarget } from "./contract.ts";

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
  "smoke",
  "smoke_exception",
  "prerequisites",
  "secret_requirements",
  "runtime_config_requirements",
  "release_actions",
  "target_exceptions",
  "stages",
  "stage_branches",
  "allowed_promotion_edges",
  "artifact_reuse_mode",
  "allowed_refs",
  "required_checks",
  "required_approvals",
  "retry_branch_policy",
  "retry_approval_reuse",
  "artifact_attestation_mode",
  "labels",
];

function deploymentBuckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

function deploymentIsolationArgs(): string[] {
  if (process.env.BUCK_NO_ISOLATION === "1") return [];
  const isolationDir = String(
    process.env.BUCK_ISOLATION_DIR ||
      process.env.BUCK_ISOLATION_DIR_EXPORTER ||
      process.env.BUCK_NESTED_ISO ||
      "",
  ).trim();
  return isolationDir ? ["--isolation-dir", isolationDir] : [];
}

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

function normalizeQueryTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  return clean.startsWith("root//") ? clean.slice("root".length) : clean;
}

function queryLabelList(node: Record<string, unknown>, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string"
        ? normalizeTargetLabel(entry)
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { label?: unknown }).label === "string"
          ? normalizeTargetLabel(String((entry as { label: string }).label))
          : "",
    )
    .filter(Boolean);
}

export async function queryDeploymentNodes(
  workspaceRoot: string,
  labels: string[],
): Promise<ReturnType<typeof nodesFromCqueryJson>> {
  const normalizedLabels = Array.from(new Set(labels.map((label) => normalizeTargetLabel(label))));
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `set(${normalizedLabels.join(" ")})`;
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: deploymentBuckEnv(),
  })`buck2 ${deploymentIsolationArgs()} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(stdout || "{}")) as Record<string, any>);
}

export async function resolveDeploymentFromTarget(
  workspaceRoot: string,
  deploymentTarget: string,
): Promise<DeploymentTarget> {
  const initialNodes = await queryDeploymentNodes(workspaceRoot, [deploymentTarget]);
  const deploymentNode = initialNodes.find((node) => node.name === deploymentTarget);
  if (!deploymentNode) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const extraLabels = [
    normalizeTargetLabel(String((deploymentNode as any).component || "")),
    normalizeTargetLabel(String((deploymentNode as any).lane_policy || "")),
    normalizeTargetLabel(String((deploymentNode as any).admission_policy || "")),
    ...queryLabelList(deploymentNode as Record<string, unknown>, "release_actions"),
    ...queryLabelList(deploymentNode as Record<string, unknown>, "target_exceptions"),
  ].filter((label) => label && label !== deploymentTarget);
  const nodes =
    extraLabels.length > 0
      ? await queryDeploymentNodes(workspaceRoot, [deploymentTarget, ...extraLabels])
      : initialNodes;
  const extracted = extractDeployments(nodes);
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const hit = extracted.deployments.find((deployment) => deployment.label === deploymentTarget);
  if (!hit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const componentLabels = componentTargetsFor(hit).filter(
    (label) => label && ![deploymentTarget, ...extraLabels].includes(label),
  );
  if (componentLabels.length === 0) return hit;
  const expanded = extractDeployments(
    await queryDeploymentNodes(workspaceRoot, [
      deploymentTarget,
      ...extraLabels,
      ...componentLabels,
    ]),
  );
  if (expanded.errors.length > 0) throw new Error(expanded.errors.join("\n"));
  const expandedHit = expanded.deployments.find(
    (deployment) => deployment.label === deploymentTarget,
  );
  if (!expandedHit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return expandedHit;
}

export async function listDeploymentTargets(workspaceRoot: string): Promise<string[]> {
  const query = 'kind("deployment_target", //projects/deployments/...)';
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
  const extraLabels = Array.from(
    new Set(
      nodes.flatMap((node) =>
        [
          normalizeTargetLabel(String((node as any).component || "")),
          normalizeTargetLabel(String((node as any).lane_policy || "")),
          normalizeTargetLabel(String((node as any).admission_policy || "")),
          ...queryLabelList(node as Record<string, unknown>, "release_actions"),
          ...queryLabelList(node as Record<string, unknown>, "target_exceptions"),
        ].filter(Boolean),
      ),
    ),
  ).filter((label) => !labels.includes(label));
  const allNodes =
    extraLabels.length > 0
      ? await queryDeploymentNodes(workspaceRoot, [...labels, ...extraLabels])
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
