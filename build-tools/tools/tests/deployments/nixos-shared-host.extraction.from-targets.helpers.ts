#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes.ts";
import { inheritedBuckIsolation } from "../lib/test-helpers.ts";

const DEPLOYMENT_CQUERY_ATTRS = [
  "name",
  "rule_type",
  "buck.type",
  "provider",
  "component",
  "component_kind",
  "components",
  "publisher",
  "provisioner",
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
  "prerequisites",
  "secret_requirements",
  "runtime_config_requirements",
  "external_requirement_profiles",
  "release_actions",
  "target_exceptions",
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

function deploymentBuckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeStaticWebappTarget(filePath: string, name: string): Promise<void> {
  await ensureParentDir(filePath);
  await fsp.writeFile(
    filePath,
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      `    name = "${name}",`,
      `    out = "${name}.txt",`,
      `    cmd = "printf ${name} > $OUT",`,
      '    labels = ["kind:app", "webapp:static"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function writeSharedLaneTargets(filePath: string): Promise<void> {
  await ensureParentDir(filePath);
  await fsp.writeFile(
    filePath,
    [
      'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_defaults", "deployment_lane_governance", "deployment_lane_policy")',
      "",
      "deployment_defaults(",
      '    name = "defaults",',
      '    default_client_profile = "mini",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_governance(",
      '    name = "lane_governance",',
      '    scm_backend = "github",',
      '    repository = "kiltyj/bucknix-fresh",',
      "    branch_protections = [",
      '        {"stage": "dev", "branch": "env/pleomino/dev", "required_checks": "deploy/pleomino-dev", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      '        {"stage": "staging", "branch": "env/pleomino/staging", "required_checks": "deploy/pleomino-staging", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      '        {"stage": "prod", "branch": "env/pleomino/prod", "required_checks": "deploy/pleomino-prod", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    defaults = ":defaults",',
      '    stages = ["dev", "staging", "prod"],',
      '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
      '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
      '    promotion_compatibility = """{"cross_provider_promotion_edges":["dev->staging"]}""",',
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "dev_release",',
      '    allowed_refs = ["env/pleomino/dev"],',
      '    required_checks = ["deploy/pleomino-dev"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function runDeploymentCquery(
  tmp: string,
  _$: any,
  isolationName: string,
  labels: string[],
) {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `set(${labels.join(" ")})`;
  const cquery = await _$({
    cwd: tmp,
    stdio: "pipe",
    env: deploymentBuckEnv(),
  })`buck2 --isolation-dir ${inheritedBuckIsolation(isolationName)} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "")) as Record<string, any>);
}
