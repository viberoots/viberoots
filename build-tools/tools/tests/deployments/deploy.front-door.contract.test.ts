#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import { listDeploymentsForCli } from "../../deployments/deploy-front-door.ts";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
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

test("deploy --validate-only validates the reviewed front-door contract without creating local records", async () => {
  await runInTemp("deploy-validate-only-contract", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    await writeTempCloudflareValidationWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
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
});

test("deploy --validate-only fails closed on malformed cloudflare provider config content", async () => {
  await runInTemp("deploy-validate-only-cloudflare-invalid-config", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, {
      wranglerConfig: '{ "name": "demo-staging-pages", "account_id": ',
    });
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
      /invalid wrangler config/,
    );
  });
});

test("deploy --validate-only validates referenced Buck target kind expectations", async () => {
  await runInTemp("deploy-validate-only-component-kind", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, {
      appLabels: ["kind:app"],
    });
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
      /is not a supported static-webapp/,
    );
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
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeTempCloudflareValidationWorkspace(tmp);
    await writeArtifact(artifactDir, "<html>demo staging</html>\n");
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/demo/staging HEAD`;
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
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
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
          BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
          BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demo-staging-pages.pages.dev/");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.provider, "cloudflare-pages");
      assert.equal(
        record.providerTargetIdentity,
        "cloudflare-pages:web-platform-staging/demo-staging-pages",
      );
    } finally {
      await server.close();
    }
  });
});

test("internal deploy entrypoint preserves cloudflare-pages provider guardrails with Buck selection", async () => {
  await runInTemp("deploy-cloudflare-provision-only-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --provision-only`,
      /does not support --provision-only/,
    );
  });
});

test("internal deploy entrypoint preserves s3-static provider guardrails", async () => {
  await runInTemp("deploy-s3-static-provision-only-guard", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture();
    await installS3StaticTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --provision-only`,
      /provisions as part of deploy/,
    );
  });
});

test("internal deploy entrypoint preserves kubernetes provider guardrails", async () => {
  await runInTemp("deploy-kubernetes-provision-only-guard", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    await installKubernetesTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --provision-only`,
      /kubernetes initial slice provisions as part of deploy/,
    );
  });
});
