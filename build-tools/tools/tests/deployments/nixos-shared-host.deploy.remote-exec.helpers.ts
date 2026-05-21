#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import {
  ensureNixosSharedHostReviewedSourceRef,
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

export const REVIEWED_PLEOMINO_DEPLOYMENT_LABEL = "//projects/deployments/pleomino/dev:deploy";
let buckQueryNonce = 0;

export function freshRemoteExecBuckIsolation(tmp: string): string {
  return stableBuckIsolation(
    path.join(tmp, `.remote-exec-query-${++buckQueryNonce}`),
    "zxtest-remote-exec",
  );
}

export function freshRemoteExecBuckEnv(
  tmp: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const isolation = freshRemoteExecBuckIsolation(tmp);
  const env = {
    ...base,
    BUCK_ISOLATION_DIR: isolation,
    BUCK_NESTED_ISO: isolation,
  };
  delete env.BUCK_ISOLATION_DIR_EXPORTER;
  return env;
}

function freshBuckQueryEnv(tmp: string): NodeJS.ProcessEnv {
  return freshRemoteExecBuckEnv(tmp);
}

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
        sourceRefPolicies: [
          { stage: "dev", allowedRefs: ["main"], requiredChecks: [] },
          {
            stage: "staging",
            allowedRefs: ["main"],
            requiredChecks: ["deploy/pleomino-staging"],
          },
          {
            stage: "prod",
            allowedRefs: ["refs/tags/release/*"],
            requiredChecks: ["deploy/pleomino-prod"],
          },
        ],
      },
    }),
  });
}

export function remoteExecEnv(env: Record<string, string>, extra: Record<string, string> = {}) {
  return {
    ...env,
    VBR_DEPLOY_CONTROL_PLANE_TOKEN: "test-control-plane-token",
    VBR_DEPLOY_LOCAL_FIXTURE_SERVICE: "1",
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
  const sharedTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "pleomino",
    "shared",
    "TARGETS",
  );
  const source = await fsp.readFile(sharedTargetsPath, "utf8");
  const nextSource = source
    .replace(
      /("stage": "dev", "allowed_refs": "main", "required_checks": ")[^"]*(")/,
      "$1deploy/pleomino-dev$2",
    )
    .replace(
      /(\s+name = "dev_release",[\s\S]*?\s+allowed_refs = \["main"\],[\s\S]*?\s+required_checks = )\[[^\]]*\](,)/,
      '$1["deploy/pleomino-dev"]$2',
    );
  if (nextSource === source) {
    throw new Error("required checks fixture update did not match pleomino/shared TARGETS");
  }
  await fsp.writeFile(sharedTargetsPath, nextSource, "utf8");
  const written = await fsp.readFile(sharedTargetsPath, "utf8");
  if (
    !written.includes('"required_checks": "deploy/pleomino-dev"') ||
    !written.includes('required_checks = ["deploy/pleomino-dev"]')
  ) {
    throw new Error("required checks fixture update did not persist to pleomino/shared TARGETS");
  }
  await waitFor(
    async () => {
      try {
        const deployment = await resolveDeploymentFromTarget(
          tmp,
          REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
          { env: freshBuckQueryEnv(tmp) },
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
    { env: freshBuckQueryEnv(opts.tmp) },
  )) as NixosSharedHostDeployment;
  await ensureNixosSharedHostReviewedSourceRef(opts.tmp, opts.$, deployment);
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
