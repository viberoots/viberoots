#!/usr/bin/env zx-wrapper
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { extractNixosSharedHostDeployments, type NixosSharedHostDeployment } from "./contract.ts";

const DEPLOYMENT_CQUERY_ATTRS = [
  "name",
  "rule_type",
  "buck.type",
  "provider",
  "component",
  "component_kind",
  "publisher",
  "provisioner",
  "protection_class",
  "lane_policy",
  "environment_stage",
  "admission_policy",
  "app_name",
  "container_port",
  "health_path",
  "target_group",
  "stages",
  "stage_branches",
  "allowed_promotion_edges",
  "artifact_reuse_mode",
  "allowed_refs",
  "required_checks",
  "required_approvals",
  "retry_branch_policy",
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
): Promise<NixosSharedHostDeployment> {
  const initialNodes = await queryDeploymentNodes(workspaceRoot, [deploymentTarget]);
  const deploymentNode = initialNodes.find((node) => node.name === deploymentTarget);
  if (!deploymentNode) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const extraLabels = [
    normalizeTargetLabel(String((deploymentNode as any).component || "")),
    normalizeTargetLabel(String((deploymentNode as any).lane_policy || "")),
    normalizeTargetLabel(String((deploymentNode as any).admission_policy || "")),
  ].filter((label) => label && label !== deploymentTarget);
  const nodes =
    extraLabels.length > 0
      ? await queryDeploymentNodes(workspaceRoot, [deploymentTarget, ...extraLabels])
      : initialNodes;
  const extracted = extractNixosSharedHostDeployments(nodes);
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const hit = extracted.deployments.find((deployment) => deployment.label === deploymentTarget);
  if (!hit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return hit;
}
