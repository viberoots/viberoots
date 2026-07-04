#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

let buckQueryNonce = 0;

function freshPromotionEnv(tmp: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const isolation = stableBuckIsolation(
    path.join(tmp, `.cloudflare-promotion-guardrail-query-${++buckQueryNonce}`),
    "zxtest-cloudflare-promotion-guardrail",
  );
  const env = {
    ...process.env,
    ...overrides,
    BUCK_ISOLATION_DIR: isolation,
    BUCK_NESTED_ISO: isolation,
  };
  delete env.BUCK_ISOLATION_DIR_EXPORTER;
  return env;
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function sampleWebappDevDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  return nixosSharedHostDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
    runtime: { appName: "sample-webapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

function fakeCloudflareEnv(fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>) {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

async function createSuccessfulDevRun(
  tmp: string,
  $: any,
  recordsRoot: string,
  _backendDatabaseUrl: string,
): Promise<string> {
  const deployment = sampleWebappDevDeployment();
  const deploymentJson = path.join(tmp, "sample-webapp-dev.json");
  const artifactDir = path.join(tmp, "artifact");
  const hostRoot = path.join(tmp, "host");
  const statePath = path.join(tmp, "platform-state.json");
  await writeArtifact(artifactDir, "<html>source</html>\n");
  await installNixosSharedHostTargets(tmp, [deployment]);
  await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
  await writeDeploymentJson(deploymentJson, deployment);
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp,
    $,
    deploymentLabel: deployment.label,
    deployment,
  });
  const originalEnv = { ...process.env };
  const env = freshPromotionEnv(tmp);
  Object.assign(process.env, env);
  const harness = await startControlPlaneHarness({
    workspaceRoot: tmp,
    hostRoot,
    statePath,
    recordsRoot,
  });
  const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
  try {
    const run = await $({
      cwd: tmp,
      env,
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
    const summary = JSON.parse(String(run.stdout));
    return summary.deployRunId;
  } finally {
    await harness.close();
    restoreProcessEnv(originalEnv);
    await server.close();
  }
}

test("promotion rejects source runs from an incompatible current lane policy", async () => {
  await runInTemp("cloudflare-pages-promotion-lane-mismatch", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    const sourceRunId = await createSuccessfulDevRun(tmp, $, recordsRoot, backendDatabaseUrl);
    const incompatibleTarget = cloudflarePagesDeploymentFixture({
      lanePolicy: {
        ...cloudflarePagesDeploymentFixture().lanePolicy,
        fingerprint: "sha256:lane-other",
      },
    });
    await installCloudflarePagesTargets(tmp, [incompatibleTarget]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, incompatibleTarget);
    await assert.rejects(
      resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: incompatibleTarget,
        recordsRoot,
        sourceRunId,
        backendDatabaseUrl,
      }),
      /lanePolicyFingerprint mismatch/,
    );
  });
});

test("promotion rejects retained source runs that no longer match source current stage state", async () => {
  await runInTemp("cloudflare-pages-promotion-source-stage-drift", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    const source = sampleWebappDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: source.lanePolicy,
      lanePolicyRef: source.lanePolicyRef,
    });
    await installCloudflarePagesTargets(tmp, [staging]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    const sourceRunId = await createSuccessfulDevRun(tmp, $, recordsRoot, backendDatabaseUrl);
    await createSuccessfulDevRun(tmp, $, recordsRoot, backendDatabaseUrl);
    await assert.rejects(
      resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId,
        backendDatabaseUrl,
      }),
      /source run is not the current stage state/,
    );
  });
});

test("promotion rejects attempts to reuse one deployment id instead of promoting to a distinct target deployment", async () => {
  await runInTemp("cloudflare-pages-promotion-distinct-target", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const artifactDir = path.join(tmp, "artifact");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>staging source</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    Object.assign(process.env, fakeCloudflareEnv(fake));
    try {
      const admissionEvidence = deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: "rev-cloudflare-promotion-guardrail-1",
        artifactIdentity: "artifact-cloudflare-promotion-guardrail-1",
        artifactLineageId: "artifact-cloudflare-promotion-guardrail-1",
      });
      const result = await submitCloudflarePagesControlPlaneDeploy({
        workspaceRoot: tmp,
        deployment,
        artifactDir,
        recordsRoot,
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      await assert.rejects(
        resolveCloudflarePagesPromotionSelection({
          workspaceRoot: tmp,
          deployment,
          recordsRoot,
          sourceRunId: result.record.deployRunId,
        }),
        /requires a distinct target deployment id/,
      );
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.VBR_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.VBR_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await server.close();
    }
  });
});
