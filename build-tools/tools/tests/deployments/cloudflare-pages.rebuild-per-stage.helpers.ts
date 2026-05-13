#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { installCloudflarePagesTargets } from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { writeDeploymentJson } from "./nixos-shared-host.reuse.e2e.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture";

let buckQueryNonce = 0;

export async function writeCloudflareArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

export async function writeWranglerConfig(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

export function rebuildDevDeployment(): CloudflarePagesDeployment {
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-rebuild-dev-pages",
    label: "//projects/deployments/pleomino-rebuild-dev-pages:deploy",
    environmentStage: "dev",
    lanePolicyRef: rebuildLanePolicy().ref,
    lanePolicy: rebuildLanePolicy(),
    admissionPolicyRef: rebuildDevAdmissionPolicy().ref,
    admissionPolicy: rebuildDevAdmissionPolicy(),
    providerTarget: {
      account: "web-platform-dev",
      project: "pleomino-rebuild-dev-pages",
      id: "pleomino-rebuild-dev-pages",
      canonicalUrl: "https://pleomino-rebuild-dev-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-dev/pleomino-rebuild-dev-pages",
    },
  });
}

export function rebuildStagingDeployment(): CloudflarePagesDeployment {
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-rebuild-staging",
    label: "//projects/deployments/pleomino-rebuild-staging:deploy",
    lanePolicyRef: rebuildLanePolicy().ref,
    lanePolicy: rebuildLanePolicy(),
    admissionPolicyRef: rebuildStagingAdmissionPolicy().ref,
    admissionPolicy: rebuildStagingAdmissionPolicy(),
    providerTarget: {
      account: "web-platform-staging",
      project: "pleomino-rebuild-staging-pages",
      id: "pleomino-rebuild-staging-pages",
      canonicalUrl: "https://pleomino-rebuild-staging-pages.pages.dev/",
      providerTargetIdentity:
        "cloudflare-pages:web-platform-staging/pleomino-rebuild-staging-pages",
    },
  });
}

export function fakeCloudflareEnv(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

export function freshRebuildCloudflareEnv(
  tmp: string,
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
): NodeJS.ProcessEnv {
  const isolation = stableBuckIsolation(
    path.join(tmp, `.cloudflare-rebuild-query-${++buckQueryNonce}`),
    "zxtest-cloudflare-rebuild",
  );
  const env = {
    ...fakeCloudflareEnv(fake),
    BUCK_ISOLATION_DIR: isolation,
    BUCK_NESTED_ISO: isolation,
  };
  delete env.BUCK_ISOLATION_DIR_EXPORTER;
  return env;
}

export async function createSourceRun(
  tmp: string,
  $: any,
  recordsRoot: string,
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
): Promise<{
  deployment: CloudflarePagesDeployment;
  summary: Record<string, any>;
  record: Record<string, any>;
}> {
  const deployment = rebuildDevDeployment();
  const deploymentJson = path.join(tmp, "pleomino-rebuild-dev-pages.json");
  const artifactDir = path.join(tmp, "source-artifact");
  await writeCloudflareArtifact(artifactDir, "<html>source release</html>\n");
  await writeWranglerConfig(
    path.join(tmp, "projects", "deployments", "pleomino-rebuild-dev-pages", "wrangler.jsonc"),
  );
  await installCloudflarePagesTargets(tmp, [deployment]);
  await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
  await writeDeploymentJson(deploymentJson, deployment);
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp,
    $,
    deploymentLabel: deployment.label,
    deployment,
  });
  const server = await startCloudflarePagesPublicServer({
    deployment,
    publishRoot: fake.publishRoot,
    tlsRoot: tmp,
  });
  try {
    const run = await $({
      cwd: tmp,
      env: freshRebuildCloudflareEnv(tmp, fake),
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
    const summary = JSON.parse(String(run.stdout));
    const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
    return { deployment, summary, record };
  } finally {
    await server.close();
  }
}

function rebuildLanePolicy() {
  return nixosSharedHostLanePolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:lane",
    name: "lane",
    governance: nixosSharedHostLaneGovernanceFixture({
      ref: "//projects/deployments/pleomino-rebuild-shared:lane_governance",
      sourceRefPolicies: [
        sourceRefPolicy("dev", "main"),
        sourceRefPolicy("staging", "main"),
        sourceRefPolicy("prod", "refs/tags/release/*"),
      ],
    }),
    artifactReuseMode: "rebuild_per_stage",
    fingerprint: "sha256:lane-pleomino-rebuild-per-stage",
  });
}

function rebuildDevAdmissionPolicy() {
  return nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:dev_release",
    name: "dev_release",
    requiredChecks: [],
  });
}

function rebuildStagingAdmissionPolicy() {
  return nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:staging_release",
    name: "staging_release",
    allowedRefs: ["main"],
    requiredChecks: [],
    fingerprint: "sha256:admission-pleomino-rebuild-staging",
  });
}

function sourceRefPolicy(stage: string, ref: string) {
  return {
    stage,
    allowedRefs: [ref],
    requiredChecks: [],
  };
}
