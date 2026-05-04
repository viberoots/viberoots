#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractKubernetesDeployments } from "../../deployments/contract";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";

const ATTRS =
  "name,provider,component,component_kind,publisher,publisher_config,protection_class,lane_policy,environment_stage,admission_policy,provider_target,components,prerequisites,secret_requirements,runtime_config_requirements,governance_policy,defaults,default_client_profile,scm_backend,repository,branch_protections,stages,stage_branches,allowed_promotion_edges,promotion_compatibility,allowed_refs,required_checks,labels".split(
    ",",
  );

async function writeTargets(tmp: string): Promise<void> {
  await fsp.mkdir(path.join(tmp, "projects/apps/api"), { recursive: true });
  await fsp.mkdir(path.join(tmp, "projects/deployments/api-prod"), { recursive: true });
  await fsp.mkdir(path.join(tmp, "projects/deployments/pleomino-shared"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "projects/apps/api/TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'genrule(name = "image", out = "image.txt", cmd = "echo api > $OUT", labels = ["kind:app"], visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(tmp, "projects/deployments/pleomino-shared/TARGETS"),
    [
      'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_defaults", "deployment_lane_governance", "deployment_lane_policy")',
      'deployment_defaults(name = "defaults", visibility = ["PUBLIC"])',
      'deployment_lane_governance(name = "lane_governance", scm_backend = "github", repository = "kiltyj/bucknix-fresh", branch_protections = [{"stage": "prod", "branch": "env/pleomino/prod", "required_checks": "deploy/pleomino-prod", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"}], visibility = ["PUBLIC"])',
      'deployment_lane_policy(name = "lane", defaults = ":defaults", stages = ["prod"], stage_branches = {"prod": "env/pleomino/prod"}, allowed_promotion_edges = [], governance_policy = ":lane_governance", visibility = ["PUBLIC"])',
      'deployment_admission_policy(name = "prod_release", allowed_refs = ["env/pleomino/prod"], required_checks = ["deploy/pleomino-prod"], visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(tmp, "projects/deployments/api-prod/TARGETS"),
    [
      'load("//build-tools/deployments:defs.bzl", "kubernetes_service_deployment")',
      "kubernetes_service_deployment(",
      '    name = "web",',
      '    component = "//projects/apps/api:image",',
      '    cluster = "prod-us-west",',
      '    namespace = "web",',
      '    release = "api",',
      '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
      '    environment_stage = "prod",',
      '    admission_policy = "//projects/deployments/pleomino-shared:prod_release",',
      ")",
      "kubernetes_service_deployment(",
      '    name = "worker",',
      '    component = "//projects/apps/api:image",',
      '    cluster = "prod-us-west",',
      '    namespace = "workers",',
      '    release = "jobs",',
      '    service_kind = "worker",',
      '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
      '    environment_stage = "prod",',
      '    admission_policy = "//projects/deployments/pleomino-shared:prod_release",',
      ")",
    ].join("\n"),
  );
}

test("kubernetes_service_deployment macro extracts web and private worker service metadata", async () => {
  await runInTemp("kubernetes-service-macro-cquery", async (tmp, $) => {
    await writeTargets(tmp);
    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/api-prod:web //projects/deployments/api-prod:worker //projects/apps/api:image //projects/deployments/pleomino-shared:lane //projects/deployments/pleomino-shared:defaults //projects/deployments/pleomino-shared:lane_governance //projects/deployments/pleomino-shared:prod_release)";
    const cquery = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("kubernetes-service-macro")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "{}")) as Record<string, unknown>;
    const { deployments, errors } = extractKubernetesDeployments([
      ...nodesFromCqueryJson(merged),
      kubernetesLanePolicyNodeFixture(),
      nixosSharedHostLaneGovernanceNodeFixture(),
      kubernetesAdmissionPolicyNodeFixture({
        name: "//projects/deployments/pleomino-shared:prod_release",
        required_checks: ["deploy/pleomino-prod"],
      }),
    ]);
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 2);
    const worker = deployments.find((deployment) => deployment.name === "worker");
    const web = deployments.find((deployment) => deployment.name === "web");
    assert.equal(web?.providerTarget.ingressMode, "public");
    assert.equal(web?.providerTarget.healthPath, "/healthz");
    assert.equal(worker?.providerTarget.serviceKind, "worker");
    assert.equal(worker?.providerTarget.ingressMode, "none");
  });
});
