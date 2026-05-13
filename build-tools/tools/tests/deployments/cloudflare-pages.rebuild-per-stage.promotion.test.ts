#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  resolveCloudflarePagesPromotionSelection,
  submitCloudflarePagesRebuildPerStagePromotion,
} from "../../deployments/cloudflare-pages-promotion";
import { runInTemp } from "../lib/test-helpers";
import { installCloudflarePagesTargets } from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import {
  createSourceRun,
  fakeCloudflareEnv,
  rebuildStagingDeployment,
  writeCloudflareArtifact,
  writeWranglerConfig,
} from "./cloudflare-pages.rebuild-per-stage.helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { writeDeploymentJson } from "./nixos-shared-host.reuse.e2e.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { seedSyntheticTargetStageState } from "./nixos-shared-host.promotion.stage-state.helpers";

test("cloudflare-pages rebuild-per-stage promotion rejects publish-only exact-artifact reuse", async () => {
  await runInTemp("cloudflare-pages-rebuild-per-stage-guardrail", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const { summary, backendDatabaseUrl } = await createSourceRun(tmp, $, recordsRoot, fake);
    const staging = rebuildStagingDeployment();
    const stagingJson = path.join(tmp, "pleomino-rebuild-staging.json");
    await installCloudflarePagesTargets(tmp, [staging]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    await writeDeploymentJson(stagingJson, staging);
    await seedSyntheticTargetStageState({ recordsRoot, deployment: staging });
    await assert.rejects(
      resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: summary.deployRunId,
        backendDatabaseUrl,
      }),
      /requires target-stage rebuild/,
    );
  });
});

test("cloudflare-pages rebuild-per-stage promotion admits a new stage artifact before publish", async () => {
  await runInTemp("cloudflare-pages-rebuild-per-stage-e2e", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const {
      deployment: sourceDeployment,
      summary: sourceSummary,
      record: sourceRecord,
      backendDatabaseUrl,
    } = await createSourceRun(tmp, $, recordsRoot, fake);
    const staging = rebuildStagingDeployment();
    const stagingJson = path.join(tmp, "pleomino-rebuild-staging.json");
    const stagingArtifactDir = path.join(tmp, "staging-artifact");
    await writeCloudflareArtifact(stagingArtifactDir, "<html>stage-specific build</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-rebuild-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [sourceDeployment, staging]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, sourceDeployment);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    await writeDeploymentJson(stagingJson, staging);
    await seedSyntheticTargetStageState({ recordsRoot, deployment: staging });
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: staging.label,
      deployment: staging,
    });
    const server = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    Object.assign(process.env, fakeCloudflareEnv(fake));
    try {
      const result = await submitCloudflarePagesRebuildPerStagePromotion({
        workspaceRoot: tmp,
        deployment: staging,
        artifactDir: stagingArtifactDir,
        recordsRoot,
        sourceRunId: sourceSummary.deployRunId,
        backendDatabaseUrl,
        admissionEvidence: JSON.parse(await fsp.readFile(stagingEvidenceJson, "utf8")),
        smokeConnectOverride: {
          hostname: "127.0.0.1",
          port: server.port,
          protocol: "https:",
          rejectUnauthorized: false,
        },
      });
      const summary = {
        deployRunId: result.record.deployRunId,
        operationKind: result.record.operationKind,
        parentRunId: result.record.parentRunId,
        recordPath: result.recordPath,
      };
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      const wranglerLogs = (await fsp.readFile(fake.logPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const publishLog = wranglerLogs[wranglerLogs.length - 1];
      assert.equal(summary.operationKind, "promotion");
      assert.equal(summary.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.releaseLineageId, sourceSummary.deployRunId);
      assert.notEqual(record.artifact.identity, sourceSummary.artifactIdentity);
      assert.equal(record.artifactLineageId, record.artifact.identity);
      assert.notEqual(record.artifactLineageId, sourceRecord.artifactLineageId);
      assert.equal(record.admittedContext.source.mode, "promotion_source_run");
      assert.equal(record.admittedContext.source.sourceRunId, sourceSummary.deployRunId);
      assert.equal(record.admittedContext.source.sourceDeploymentId, sourceDeployment.deploymentId);
      assert.equal(record.admittedContext.targetEnvironment.targetRef, "main");
      assert.equal(snapshot.operationKind, "promotion");
      assert.equal(snapshot.action.publishBehavior, "deploy");
      assert.equal(snapshot.action.sourceReplaySnapshotPath, sourceRecord.replaySnapshotPath);
      assert.equal(publishLog?.projectName, staging.providerTarget.project);
      assert.equal(publishLog?.artifactDir, record.artifact.storedArtifactPath);
      assert.notEqual(publishLog?.artifactDir, sourceRecord.artifact.storedArtifactPath);
      assert.match(
        await fsp.readFile(
          path.join(fake.publishRoot, staging.providerTarget.project, "index.html"),
          "utf8",
        ),
        /stage-specific build/,
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
