#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  prepareReviewedRemoteHostPaths,
} from "./nixos-shared-host.remote-exec.install.helpers";
import { waitFor } from "./nixos-shared-host.control-plane.helpers";
export { installClientProfile } from "./nixos-shared-host.remote-exec.install.helpers";

export const REVIEWED_PLEOMINO_DEPLOYMENT_LABEL = "//projects/deployments/pleomino-dev:deploy";

export type RemoteExecFixture = {
  deployment: NixosSharedHostDeployment;
  env: Record<string, string>;
  artifactDir: string;
  admissionEvidencePath: string;
  profileRoot: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  remoteStatePath: string;
};

export function pleominoDeploymentFixture(): NixosSharedHostDeployment {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
    component: { target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
    lanePolicy: nixosSharedHostLanePolicyFixture({
      governance: {
        ...nixosSharedHostDeploymentFixture().lanePolicy.governance,
        branchProtections: [
          {
            stage: "dev",
            branch: "env/pleomino/dev",
            requiredChecks: [],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "staging",
            branch: "env/pleomino/staging",
            requiredChecks: ["deploy/pleomino-staging"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "prod",
            branch: "env/pleomino/prod",
            requiredChecks: ["deploy/pleomino-prod"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
        ],
      },
    }),
  });
}

export function remoteExecEnv(env: Record<string, string>, extra: Record<string, string> = {}) {
  return {
    ...env,
    BNX_DEPLOY_CONTROL_PLANE_TOKEN: "test-control-plane-token",
    BNX_DEPLOY_LOCAL_FIXTURE_SERVICE: "1",
    IN_NIX_SHELL: "1",
    ...extra,
  };
}

export async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

export async function listRunRecords(recordsRoot: string): Promise<string[]> {
  const runsDir = path.join(recordsRoot, "runs");
  try {
    return (await fsp.readdir(runsDir)).sort();
  } catch {
    return [];
  }
}

export async function requirePleominoDevCheck(tmp: string): Promise<void> {
  const sharedTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-shared", "TARGETS");
  const source = await fsp.readFile(sharedTargetsPath, "utf8");
  const nextSource = source
    .replace('"required_checks": "",', '"required_checks": "deploy/pleomino-dev",')
    .replace("    required_checks = [],", '    required_checks = ["deploy/pleomino-dev"],');
  if (nextSource === source) {
    throw new Error("required checks fixture update did not match pleomino-shared TARGETS");
  }
  await fsp.writeFile(sharedTargetsPath, nextSource, "utf8");
  const written = await fsp.readFile(sharedTargetsPath, "utf8");
  if (!written.includes('required_checks = ["deploy/pleomino-dev"]')) {
    throw new Error("required checks fixture update did not persist to pleomino-shared TARGETS");
  }
  await waitFor(
    async () => {
      try {
        const deployment = await resolveDeploymentFromTarget(
          tmp,
          REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
        );
        return deployment.admissionPolicy.requiredChecks.includes("deploy/pleomino-dev")
          ? deployment
          : null;
      } catch {
        return null;
      }
    },
    "timed out waiting for deployment query to reflect required checks",
    30_000,
  );
}

export async function prepareRemoteExecFixture(opts: {
  tmp: string;
  $: any;
  artifactFiles: Record<string, string>;
  remoteRepoPath?: string;
}): Promise<RemoteExecFixture> {
  const deploymentJsonPath = path.join(opts.tmp, "reviewed-deployment.json");
  const { env } = await installFakeRemoteTransport(opts.tmp);
  const artifactDir = path.join(opts.tmp, "artifact");
  const profileRoot = path.join(opts.tmp, "profiles");
  const remoteRuntimeRoot = path.join(opts.tmp, "remote-runtime");
  const remoteRecordsRoot = path.join(opts.tmp, "remote-records");
  const remoteStatePath = path.join(opts.tmp, "remote-state", "platform-state.json");
  await installReviewedPleominoTargets(opts.tmp);
  const deployment = (await resolveDeploymentFromTarget(
    opts.tmp,
    REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
  )) as NixosSharedHostDeployment;
  await ensureNixosSharedHostStageBranch(opts.tmp, opts.$, deployment);
  await prepareReviewedRemoteHostPaths({
    remoteStatePath,
    remoteRuntimeRoot,
    remoteRecordsRoot,
  });
  await writeArtifact(artifactDir, opts.artifactFiles);
  await fsp.writeFile(deploymentJsonPath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
  const admissionEvidencePath = await writeReviewedLaneAdmissionEvidenceJson({
    tmp: opts.tmp,
    $: opts.$,
    deploymentLabel: deployment.label,
    deployment,
  });
  await installClientProfile(
    opts.$,
    profileRoot,
    opts.remoteRepoPath || opts.tmp,
    remoteStatePath,
    remoteRuntimeRoot,
    remoteRecordsRoot,
  );
  return {
    deployment,
    env,
    artifactDir,
    admissionEvidencePath,
    profileRoot,
    remoteRuntimeRoot,
    remoteRecordsRoot,
    remoteStatePath,
  };
}

export async function installManagedRemoteHost(
  $: any,
  tmp: string,
  mode: "managed-dropin" | "managed-manual-wire",
) {
  const fixture = await createNixosSharedHostInstallFixture({
    root: tmp,
    topology: "plain",
    withExtraImports: true,
  });
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode ${mode}`;
  return fixture;
}
