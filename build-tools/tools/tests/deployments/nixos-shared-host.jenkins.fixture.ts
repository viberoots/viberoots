#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { reconcileSyntheticDeploymentGraph } from "./deployment-graph.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture";

export const REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL =
  "//projects/deployments/sample-webapp/dev:deploy";

export function jenkinsExecEnv(env: Record<string, string>, extra: Record<string, string> = {}) {
  return {
    ...env,
    VBR_DEPLOY_CONTROL_PLANE_TOKEN: "test-control-plane-token",
    [LOCAL_FIXTURE_SERVICE_ENV]: "1",
    IN_NIX_SHELL: "1",
    JENKINS_URL: "https://jenkins.example.invalid/job/sample-webapp",
    JOB_NAME: "sample-webapp-deploy",
    ...extra,
  };
}

export function sampleWebappDeploymentFixture() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL,
    component: { target: "//projects/apps/sample-webapp:app" },
    runtime: { appName: "sample-webapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

export async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

export async function writeJenkinsAuthFiles(
  root: string,
): Promise<{ identityFile: string; knownHostsFile: string }> {
  const identityFile = path.join(root, "jenkins-id");
  const knownHostsFile = path.join(root, "known_hosts");
  await Promise.all([
    fsp.writeFile(identityFile, "fake-private-key\n", "utf8"),
    fsp.writeFile(knownHostsFile, "mini ssh-ed25519 AAAATEST\n", "utf8"),
  ]);
  return { identityFile, knownHostsFile };
}

export async function installClientProfile(
  $: any,
  profileRoot: string,
  remoteRepoPath: string,
  remoteStatePath: string,
  remoteRuntimeRoot: string,
  remoteRecordsRoot: string,
  controlPlaneUrl: string = "http://127.0.0.1:65535",
): Promise<void> {
  process.env[LOCAL_FIXTURE_SERVICE_ENV] = "1";
  await $({
    env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
  })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path ${remoteRepoPath} --remote-state-path ${remoteStatePath} --remote-runtime-root ${remoteRuntimeRoot} --remote-records-root ${remoteRecordsRoot} --ssh-mode ssh --control-plane-url ${controlPlaneUrl}`;
}

export async function installReviewedSampleWebappTargets(tmp: string): Promise<void> {
  const appTargetsPath = path.join(tmp, "projects", "apps", "sample-webapp", "TARGETS");
  const deployTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "sample-webapp",
    "dev",
    "TARGETS",
  );
  const sharedTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "sample-webapp",
    "shared",
    "TARGETS",
  );
  await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
  await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
  await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
  await fsp.writeFile(
    appTargetsPath,
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "app",',
      '    out = "app.txt",',
      '    cmd = "printf sample-webapp > $OUT",',
      '    labels = ["kind:app", "webapp:static"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    sharedTargetsPath,
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
      "",
      "deployment_lane_governance(",
      '    name = "lane_governance",',
      '    scm_backend = "github",',
      '    repository = "viberoots/viberoots",',
      "    source_ref_policies = [",
      '        {"stage": "dev", "allowed_refs": "main", "required_checks": ""},',
      '        {"stage": "staging", "allowed_refs": "main,refs/tags/release/*", "required_checks": "deploy/sample-webapp-staging"},',
      '        {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/sample-webapp-prod"},',
      "    ],",
      '    trusted_reporter_identities = ["app:deploy-bot"],',
      "    required_approval_boundaries = [",
      '        {"stage": "prod", "required_approvals": "release-owner"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["dev", "staging", "prod"],',
      '    source_ref_policy = {"dev": "main", "staging": "main", "prod": "refs/tags/release/*"},',
      '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
      '    artifact_reuse_mode = "same_artifact",',
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "dev_release",',
      '    allowed_refs = ["main"],',
      "    required_checks = [],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    deployTargetsPath,
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
      "",
      "nixos_shared_host_static_webapp_deployment(",
      '    name = "deploy",',
      '    component = "//projects/apps/sample-webapp:app",',
      '    lane_policy = "//projects/deployments/sample-webapp/shared:lane",',
      '    environment_stage = "dev",',
      '    admission_policy = "//projects/deployments/sample-webapp/shared:dev_release",',
      '    app_name = "sample-webapp",',
      "    container_port = 3000,",
      '    health_path = "/healthz",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await reconcileSyntheticDeploymentGraph(tmp);
}

export async function requireServiceAuthForSampleWebapp(tmp: string): Promise<void> {
  const deployTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "sample-webapp",
    "dev",
    "TARGETS",
  );
  await fsp.writeFile(
    deployTargetsPath,
    (await fsp.readFile(deployTargetsPath, "utf8")).replace(
      '    health_path = "/healthz",',
      [
        '    health_path = "/healthz",',
        "    vault_runtime = {",
        '        "oidc_issuer": "https://identity.example.test",',
        '        "audience": "deployments-vault",',
        '        "cli_public_client_id": "deployment-cli",',
        '        "deployment_environment": "mini",',
        '        "preferred_credential_source": "interactive_pkce",',
        "    },",
      ].join("\n"),
    ),
    "utf8",
  );
}

export async function writeReviewedSampleWebappAdmissionEvidence(
  tmp: string,
  $: any,
): Promise<{ admissionEvidencePath: string; deployment: NixosSharedHostDeployment }> {
  const deploymentJson = path.join(tmp, "reviewed-deployment.json");
  const deployment = (await resolveDeploymentFromTarget(
    tmp,
    REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL,
  )) as NixosSharedHostDeployment;
  await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
  return {
    deployment,
    admissionEvidencePath: await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    }),
  };
}

export async function prepareReviewedRemoteHostPaths(opts: {
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
}): Promise<void> {
  await Promise.all([
    fsp.mkdir(path.dirname(opts.remoteStatePath), { recursive: true }),
    fsp.mkdir(opts.remoteRuntimeRoot, { recursive: true }),
    fsp.mkdir(opts.remoteRecordsRoot, { recursive: true }),
  ]);
}

export async function installManagedRemoteHost($: any, tmp: string) {
  const fixture = await createNixosSharedHostInstallFixture({
    root: tmp,
    topology: "plain",
    withExtraImports: true,
  });
  await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
  return fixture;
}
