#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake.ts";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  prepareReviewedRemoteHostPaths,
} from "./nixos-shared-host.remote-exec.install.helpers.ts";
export { installClientProfile } from "./nixos-shared-host.remote-exec.install.helpers.ts";

export const REVIEWED_PLEOMINO_DEPLOYMENT_LABEL =
  "//test-workspace/deployments/pleomino-dev:deploy";

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
    component: { target: "//test-workspace/apps/pleomino:app" },
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
  return { ...env, IN_NIX_SHELL: "1", ...extra };
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
