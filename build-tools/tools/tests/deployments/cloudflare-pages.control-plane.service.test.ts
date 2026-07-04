#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
  cloudflarePagesPreviewFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { deriveCloudflarePagesPreviewTarget } from "../../deployments/cloudflare-pages-preview";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  readBackendSnapshot,
  readRecord,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { installHarnessClientProfile } from "./nixos-shared-host.remote-exec.install.helpers";
import { fakeJwt } from "./deploy-vault-jwt.test-helpers";
import { startFakeVaultServer } from "./vault.test-server";
import {
  fakeCloudflareOverrides,
  writeCloudflareServiceArtifact,
  writeWranglerConfig,
} from "./cloudflare-pages.service-flow.helpers";

test("public cloudflare-pages deploy routes deploy, preview, cleanup, and rollback through the control-plane service", async () => {
  await runInTemp("cloudflare-pages-public-service-flow", async (tmp, $) => {
    const issuer = "https://identity.example.test";
    const workerJwt = fakeJwt({
      iss: issuer,
      aud: "deployments-vault",
      azp: "deployment-runner",
      deployment_environment: "mini",
      repository: "viberoots/viberoots",
    });
    const vault = await startFakeVaultServer(
      {
        "secret://deployments/sample-webapp/cloudflare_api_token": {
          currentVersion: "1",
          versions: { "1": { value: "service-secret-token" } },
        },
      },
      { jwtAuth: { role: "deploy-sample-webapp-read", jwt: workerJwt } },
    );
    const deployment = cloudflarePagesDeploymentFixture({
      lanePolicy: nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" }),
      preview: cloudflarePagesPreviewFixture(),
      secretRequirements: cloudflarePagesApiTokenRequirements(),
      vaultRuntime: {
        addr: vault.addr,
        oidcIssuer: issuer,
        audience: "deployments-vault",
        deploymentClientId: "deployment-runner",
        deploymentEnvironment: "mini",
        roleName: "deploy-sample-webapp-read",
        preferredCredentialSource: "external_oidc_token",
        externalOidcTokenEnv: "VBR_WORKER_OIDC_TOKEN",
      },
    });
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeCloudflareServiceArtifact(artifactA, "<html>artifact-a</html>\n");
    await writeCloudflareServiceArtifact(artifactB, "<html>artifact-b</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    let previewServer: Awaited<ReturnType<typeof startCloudflarePagesPublicServer>> | undefined;
    try {
      const workerEnv = {
        ...fakeCloudflareOverrides(fake),
        VBR_WORKER_OIDC_TOKEN: workerJwt,
      };
      await withEnvOverrides(workerEnv, async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot,
          statePath,
          recordsRoot,
        });
        try {
          const env = { ...process.env, ...fakeCloudflareOverrides(fake) };
          delete env.VBR_WORKER_OIDC_TOKEN;
          env.VBR_DEPLOY_CONTROL_PLANE_TOKEN = "test-control-plane-token";
          const profileRoot = await installHarnessClientProfile($, tmp, harness.controlPlane.url);
          const firstRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactA} --profile-root ${profileRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const firstSummary = JSON.parse(String(firstRun.stdout));
          assert.equal(firstSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in firstSummary, false);
          const firstRecord = await readRecord(harness.controlPlane.url, firstSummary.deployRunId);
          assert.equal("submissionPath" in (firstRecord.controlPlane || {}), false);
          assert.equal("executionSnapshotPath" in (firstRecord.controlPlane || {}), false);
          const firstSnapshot = await readBackendSnapshot(
            recordsRoot,
            firstRecord.controlPlane.submissionId,
          );
          const serializedSnapshot = JSON.stringify(firstSnapshot);
          assert.equal(firstSnapshot.vaultRuntime.addr, vault.addr);
          assert.equal(firstSnapshot.action.publishInput.artifact.producerKind, "client_upload");
          assert.match(
            firstSnapshot.action.publishInput.artifact.storageReference,
            /^upload-session:/,
          );
          assert.ok(!serializedSnapshot.includes(artifactA));
          assert.ok(!serializedSnapshot.includes(workerJwt));
          assert.ok(!serializedSnapshot.includes("service-secret-token"));

          previewServer = await startCloudflarePagesPublicServer({
            deployment,
            publishRoot: fake.publishRoot,
            effectiveRunTarget: deriveCloudflarePagesPreviewTarget(
              deployment,
              firstSummary.deployRunId,
            ),
            tlsRoot: tmp,
          });
          const previewRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview --source-run-id ${firstSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(previewServer.port)} --smoke-connect-protocol https:`;
          const previewSummary = JSON.parse(String(previewRun.stdout));
          assert.equal(previewSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in previewSummary, false);

          const cleanupRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview-cleanup --source-run-id ${firstSummary.deployRunId} --cleanup-reason manual_cleanup --control-plane-url ${harness.controlPlane.url}`;
          const cleanupSummary = JSON.parse(String(cleanupRun.stdout));
          assert.equal(cleanupSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in cleanupSummary, false);

          const secondRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactB} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const secondSummary = JSON.parse(String(secondRun.stdout));
          assert.equal(secondSummary.finalOutcome, "succeeded");

          const rollbackRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${firstSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const rollbackSummary = JSON.parse(String(rollbackRun.stdout));
          assert.equal(rollbackSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in rollbackSummary, false);
        } finally {
          await harness.close();
        }
      });
    } finally {
      if (previewServer) await previewServer.close();
      await normalServer.close();
      await vault.close();
    }
  });
});
