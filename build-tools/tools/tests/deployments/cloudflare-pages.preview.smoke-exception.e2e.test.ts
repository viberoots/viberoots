#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  deriveCloudflarePagesPreviewTarget,
  cloudflarePagesPublishedPath,
} from "../../deployments/cloudflare-pages-preview.ts";
import {
  cloudflarePagesDeploymentFixture,
  cloudflarePagesPreviewFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
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

async function runNormalDeploy(opts: {
  tmp: string;
  $: any;
  deployment: any;
  artifactDir: string;
  recordsRoot: string;
  serverPort: number;
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>;
}) {
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp: opts.tmp,
    $: opts.$,
    deploymentLabel: opts.deployment.label,
    deployment: opts.deployment,
  });
  const normalRun = await $({
    cwd: opts.tmp,
    env: fakeCloudflareEnv(opts.fake),
  })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${opts.deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${opts.artifactDir} --records-root ${opts.recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(opts.serverPort)} --smoke-connect-protocol https:`;
  return JSON.parse(String(normalRun.stdout));
}

test("cloudflare-pages preview smoke remains blocking by default without an explicit smoke exception", async () => {
  await runInTemp("cloudflare-pages-preview-smoke-blocking", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>expected preview</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const normalSummary = await runNormalDeploy({
        tmp,
        $,
        deployment,
        artifactDir,
        recordsRoot,
        serverPort: normalServer.port,
        fake,
      });
      const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
        tmp,
        $,
        deploymentLabel: deployment.label,
        deployment,
      });
      await normalServer.close();
      const previewTarget = deriveCloudflarePagesPreviewTarget(
        deployment,
        normalSummary.deployRunId,
      );
      const wrongRoot = path.join(tmp, "wrong-preview-root");
      await writeArtifact(
        cloudflarePagesPublishedPath(wrongRoot, previewTarget),
        "<html>wrong preview</html>\n",
      );
      const previewServer = await startCloudflarePagesPublicServer({
        deployment,
        effectiveRunTarget: previewTarget,
        publishRoot: wrongRoot,
        tlsRoot: tmp,
      });
      try {
        await assert.rejects(
          async () =>
            await $({
              cwd: tmp,
              env: fakeCloudflareEnv(fake),
            })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview --source-run-id ${normalSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(previewServer.port)} --smoke-connect-protocol https:`,
          /smoke content mismatch/,
        );
        const runFiles = await fsp.readdir(path.join(recordsRoot, "runs"));
        const latest = runFiles.sort().at(-1) || "";
        const record = JSON.parse(
          await fsp.readFile(path.join(recordsRoot, "runs", latest), "utf8"),
        );
        assert.equal(record.publishMode, "preview");
        assert.equal(record.finalOutcome, "smoke_failed_after_publish");
      } finally {
        await previewServer.close().catch(() => {});
      }
    } finally {
      await normalServer.close().catch(() => {});
    }
  });
});

test("cloudflare-pages preview records nonblocking smoke failures only when deployment metadata documents the exception", async () => {
  await runInTemp("cloudflare-pages-preview-smoke-exception", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
      smoke: {
        exception: {
          owner: "web-platform",
          reason: "preview DNS settles slowly during review environments",
          scope: "preview-downgrade-to-nonblocking",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>expected preview</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const normalSummary = await runNormalDeploy({
        tmp,
        $,
        deployment,
        artifactDir,
        recordsRoot,
        serverPort: normalServer.port,
        fake,
      });
      const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
        tmp,
        $,
        deploymentLabel: deployment.label,
        deployment,
      });
      await normalServer.close();
      const previewTarget = deriveCloudflarePagesPreviewTarget(
        deployment,
        normalSummary.deployRunId,
      );
      const wrongRoot = path.join(tmp, "wrong-preview-root");
      await writeArtifact(
        cloudflarePagesPublishedPath(wrongRoot, previewTarget),
        "<html>wrong preview</html>\n",
      );
      const previewServer = await startCloudflarePagesPublicServer({
        deployment,
        effectiveRunTarget: previewTarget,
        publishRoot: wrongRoot,
        tlsRoot: tmp,
      });
      try {
        const previewRun = await $({
          cwd: tmp,
          env: fakeCloudflareEnv(fake),
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview --source-run-id ${normalSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(previewServer.port)} --smoke-connect-protocol https:`;
        const previewSummary = JSON.parse(String(previewRun.stdout));
        assert.equal(previewSummary.finalOutcome, "succeeded");
        assert.equal(previewSummary.smokeOutcome, "failed_nonblocking");
        const record = JSON.parse(await fsp.readFile(previewSummary.recordPath, "utf8"));
        assert.equal(record.publishMode, "preview");
        assert.equal(record.finalOutcome, "succeeded");
        assert.equal(record.smokeOutcome, "failed_nonblocking");
        assert.equal(record.smokeException.owner, "web-platform");
      } finally {
        await previewServer.close().catch(() => {});
      }
    } finally {
      await normalServer.close().catch(() => {});
    }
  });
});
