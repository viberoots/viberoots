#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { createClientManifest } from "../../deployments/nixos-shared-host-client-manifest";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { writeTempCloudflareValidationWorkspace } from "./deploy.front-door.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { infisicalSecret } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import {
  readRecord,
  readStatus,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import { seedCurrentStageState } from "./nixos-shared-host.promotion.stage-state.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";

let buckQueryNonce = 0;

function freshBuckEnv(tmp: string, prefix: string): NodeJS.ProcessEnv {
  const isolation = stableBuckIsolation(
    path.join(tmp, `.${prefix}-${++buckQueryNonce}`),
    `zxtest-${prefix}`,
  );
  const env = { ...process.env, BUCK_ISOLATION_DIR: isolation, BUCK_NESTED_ISO: isolation };
  delete env.BUCK_ISOLATION_DIR_EXPORTER;
  return env;
}

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>infisical front door</html>\n");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n");
}

async function writeMiniProfile(root: string, controlPlaneUrl: string): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  const { fileName, manifest } = createClientManifest({
    profileName: "mini",
    destination: "root@mini.home.kilty.io",
    remoteRepoPath: "/srv/viberoots",
    remoteStatePath: "/var/lib/deployment-host/platform-state.json",
    remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
    remoteRecordsRoot: "/var/lib/deployment-host/records",
    sshMode: "ssh",
    controlPlaneUrl,
    toolFingerprint: "test",
  });
  await fsp.writeFile(path.join(root, fileName), JSON.stringify(manifest, null, 2) + "\n");
  return root;
}

function fakeCloudflareOverrides(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

function assertRedacted(value: unknown) {
  const text = JSON.stringify(value);
  assert.equal(text.includes("runtime-token-v3"), false);
  assert.equal(text.includes("server-local-secret"), false);
}

function assertInfisicalRecord(record: any) {
  assert.equal(record.finalOutcome, "succeeded");
  assert.equal(record.admittedContext.admittedSecretReferences[0].backend, "infisical");
  assert.match(record.admittedContext.admittedSecretReferences[0].referenceId, /^infisical:/);
  assertRedacted(record);
}

async function seedStageFromRecord(opts: {
  tmp: string;
  recordsRoot: string;
  deployment: any;
  record: any;
}) {
  const recordPath = path.join(opts.tmp, `${opts.record.deployRunId}.json`);
  await fsp.writeFile(recordPath, JSON.stringify(opts.record, null, 2) + "\n");
  await seedCurrentStageState({
    recordsRoot: opts.recordsRoot,
    recordPath,
    deployment: opts.deployment,
  });
}

test("public deploy front door admits, runs, redacts, and replays Infisical via mini profile", async () => {
  await runInTemp("deploy-infisical-front-door", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-staging:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const infisical = await startFakeInfisicalServer(
      {
        clientId: "mini-worker",
        clientSecret: "server-local-secret",
        accessToken: "infisical-access",
      },
      [infisicalSecret()],
    );
    await writeTempCloudflareValidationWorkspace(tmp, { infisicalSiteUrl: infisical.siteUrl });
    await writeArtifact(artifactDir);
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deployment,
      deploymentLabel,
    });
    const server = await startCloudflarePagesPublicServer({
      deployment: deployment as any,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      await withEnvOverrides(
        {
          ...fakeCloudflareOverrides(fake),
          VBR_MINI_INFISICAL_CLIENT_ID: "mini-worker",
          VBR_MINI_INFISICAL_CLIENT_SECRET: "server-local-secret",
        },
        async () => {
          const harness = await startControlPlaneHarness({
            workspaceRoot: tmp,
            hostRoot,
            recordsRoot,
          });
          try {
            const profileRoot = await writeMiniProfile(
              path.join(tmp, "profiles"),
              harness.controlPlane.url,
            );
            const env = freshBuckEnv(tmp, "deploy-infisical-public");
            const validate = await $({
              cwd: tmp,
              stdio: "pipe",
              env,
            })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --validate-only`;
            const validation = JSON.parse(String(validate.stdout));
            assert.equal(validation.schemaVersion, "deploy-validate@1");
            assert.equal(validation.valid, true);
            const deploy = await $({
              cwd: tmp,
              env,
            })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
            const first = JSON.parse(String(deploy.stdout));
            assert.equal(first.finalOutcome, "succeeded");
            const firstRecord = await readRecord(harness.controlPlane.url, first.deployRunId);
            await seedStageFromRecord({
              tmp,
              recordsRoot,
              deployment: deployment as any,
              record: firstRecord,
            });
            assertInfisicalRecord(firstRecord);
            const status = await readStatus(
              harness.controlPlane.url,
              firstRecord.controlPlane.submissionId,
            );
            assertRedacted(status);
            await writeArtifact(artifactDir);
            const current = await $({
              cwd: tmp,
              env,
            })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
            const currentSummary = JSON.parse(String(current.stdout));
            const currentRecord = await readRecord(
              harness.controlPlane.url,
              currentSummary.deployRunId,
            );
            await seedStageFromRecord({
              tmp,
              recordsRoot,
              deployment: deployment as any,
              record: currentRecord,
            });
            const replay = await $({
              cwd: tmp,
              env,
            })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${first.deployRunId} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
            const replaySummary = JSON.parse(String(replay.stdout));
            assert.equal(replaySummary.finalOutcome, "succeeded");
            assert.equal(replaySummary.parentRunId, first.deployRunId);
            const replayRecord = await readRecord(
              harness.controlPlane.url,
              replaySummary.deployRunId,
            );
            assertInfisicalRecord(replayRecord);
            assert.equal(replayRecord.parentRunId, first.deployRunId);
          } finally {
            await harness.close();
          }
        },
      );
    } finally {
      await server.close();
      await infisical.close();
    }
  });
});
