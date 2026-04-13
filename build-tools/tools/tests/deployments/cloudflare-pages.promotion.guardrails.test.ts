#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendDeployRecord,
} from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

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

function pleominoDevDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino-dev:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
  });
}

function fakeCloudflareEnv(fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>) {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

async function createSuccessfulDevRun(
  tmp: string,
  $: any,
  recordsRoot: string,
  backendDatabaseUrl: string,
): Promise<string> {
  const deployment = pleominoDevDeployment();
  const deploymentJson = path.join(tmp, "pleomino-dev.json");
  const artifactDir = path.join(tmp, "artifact");
  const hostRoot = path.join(tmp, "host");
  const statePath = path.join(tmp, "platform-state.json");
  await writeArtifact(artifactDir, "<html>source</html>\n");
  await ensureNixosSharedHostStageBranch(tmp, $, deployment);
  await writeDeploymentJson(deploymentJson, deployment);
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp,
    $,
    deploymentJson,
    deployment,
  });
  const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
  try {
    const run = await $({
      cwd: tmp,
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
    const summary = JSON.parse(String(run.stdout));
    await syncBackendDeployRecord(
      { recordsRoot, databaseUrl: backendDatabaseUrl },
      summary.recordPath,
    );
    return summary.deployRunId;
  } finally {
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
    await ensureNixosSharedHostStageBranch(tmp, $, incompatibleTarget);
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

test("promotion rejects retained source runs that no longer match the current promotable target state", async () => {
  await runInTemp("cloudflare-pages-promotion-eligibility-drift", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    const source = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: source.lanePolicy,
      lanePolicyRef: source.lanePolicyRef,
    });
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const sourceRunId = await createSuccessfulDevRun(tmp, $, recordsRoot, backendDatabaseUrl);
    await $({ cwd: tmp, stdio: "pipe" })`git config user.email test@example.com`;
    await $({ cwd: tmp, stdio: "pipe" })`git config user.name Test`;
    await $({ cwd: tmp, stdio: "pipe" })`git commit --allow-empty -m drift`;
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`git branch -f ${staging.lanePolicy.stageBranches.staging} HEAD`;
    await assert.rejects(
      resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId,
        backendDatabaseUrl,
      }),
      /no longer matches current promotable target state/,
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
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
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
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await server.close();
    }
  });
});
