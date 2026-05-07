#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { listDeploymentsForCli } from "../../deployments/deploy-front-door";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import {
  readRecord,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";

let buckQueryNonce = 0;

function freshBuckEnv(tmp: string, prefix: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BUCK_NESTED_ISO: stableBuckIsolation(
      path.join(tmp, `.${prefix}-${++buckQueryNonce}`),
      `zxtest-${prefix}`,
    ),
  };
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

function fakeCloudflareOverrides(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

function fakeCloudflareEnv(fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>) {
  return {
    ...process.env,
    ...fakeCloudflareOverrides(fake),
  };
}

test("deploy --list returns the stable repo-level discovery document from scaffolded targets", async () => {
  await runInTemp("deploy-list-contract", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const listed = await listDeploymentsForCli(tmp);
    assert.equal(listed.schemaVersion, "deploy-list@1");
    assert.ok(
      listed.deployments.some((entry) => entry.label === "//sandbox/deployments/demo-dev:deploy"),
    );
  });
});

test("deploy --validate-only preserves cloudflare-pages front-door contracts", async (t) => {
  await runInTemp("deploy-validate-only-cloudflare-contracts", async (tmp, $) => {
    await t.test("validates the reviewed contract without creating local records", async () => {
      const recordsRoot = path.join(tmp, "records");
      await writeTempCloudflareValidationWorkspace(tmp);
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
        env: freshBuckEnv(tmp, "deploy-validate"),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`;
      const payload = JSON.parse(String(result.stdout));
      assert.equal(payload.schemaVersion, "deploy-validate@1");
      assert.equal(payload.valid, true);
      assert.equal(
        await fsp
          .access(recordsRoot)
          .then(() => "present")
          .catch(() => "missing"),
        "missing",
      );
    });

    await t.test("fails closed on malformed provider config content", async () => {
      await writeTempCloudflareValidationWorkspace(tmp, {
        wranglerConfig: '{ "name": "demo-staging-pages", "account_id": ',
      });
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: freshBuckEnv(tmp, "deploy-validate"),
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
        /invalid wrangler config/,
      );
    });

    await t.test("validates referenced Buck target kind expectations", async () => {
      await writeTempCloudflareValidationWorkspace(tmp, {
        appLabels: ["kind:app"],
      });
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: freshBuckEnv(tmp, "deploy-validate"),
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
        /is not a supported static-webapp/,
      );
    });
  });
});

test("public deploy front door rejects --deployment-json as an operator input", async () => {
  await runInTemp("deploy-public-rejects-deployment-json", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, cloudflarePagesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --validate-only`,
      /public repo-level deploy requires --deployment <label>/,
    );
  });
});

test("deploy front door runs a cloudflare-pages deploy from Buck-backed metadata", async () => {
  await runInTemp("deploy-cloudflare-buck-authoritative", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-staging:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeTempCloudflareValidationWorkspace(tmp);
    await writeArtifact(artifactDir, "<html>demo staging</html>\n");
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
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
      await withEnvOverrides(fakeCloudflareOverrides(fake), async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot,
          statePath,
          recordsRoot,
        });
        try {
          const result = await $({
            cwd: tmp,
            env: fakeCloudflareEnv(fake),
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
          const summary = JSON.parse(String(result.stdout));
          assert.equal(summary.finalOutcome, "succeeded");
          assert.equal(summary.publicUrl, "https://demo-staging-pages.pages.dev/");
          assert.equal("recordPath" in summary, false);
          const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
          assert.equal(record.provider, "cloudflare-pages");
          assert.equal(
            record.providerTargetIdentity,
            "cloudflare-pages:web-platform-staging/demo-staging-pages",
          );
        } finally {
          await harness.close();
        }
      });
    } finally {
      await server.close();
    }
  });
});

test("internal deploy entrypoint preserves provider reuse guardrails", async (t) => {
  await runInTemp("deploy-internal-provider-reuse-guards", async (tmp, $) => {
    await t.test("cloudflare-pages rejects provision-only with Buck selection", async () => {
      const deployment = cloudflarePagesDeploymentFixture();
      await installCloudflarePagesTargets(tmp, [deployment]);
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: freshBuckEnv(tmp, "provider-reuse"),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --provision-only`,
        /does not support --provision-only/,
      );
    });

    await t.test("s3-static requires source-run-id for publish-only reuse", async () => {
      const deployment = s3StaticDeploymentFixture();
      await installS3StaticTargets(tmp, [deployment]);
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: freshBuckEnv(tmp, "provider-reuse"),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --publish-only`,
        /s3-static --publish-only requires --source-run-id/,
      );
    });

    await t.test("kubernetes requires source-run-id for publish-only reuse", async () => {
      const deployment = kubernetesDeploymentFixture();
      await installKubernetesTargets(tmp, [deployment]);
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: freshBuckEnv(tmp, "provider-reuse"),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --publish-only`,
        /kubernetes --publish-only requires --source-run-id/,
      );
    });
  });
});
