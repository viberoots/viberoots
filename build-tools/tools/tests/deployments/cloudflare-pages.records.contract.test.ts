#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture";
import {
  deriveCloudflarePagesPreviewTarget,
  cloudflarePagesPreviewIdentitySelector,
} from "../../deployments/cloudflare-pages-preview";
import { createCloudflarePagesDeployRecord } from "../../deployments/cloudflare-pages-records";

test("cloudflare-pages preview records preserve both live and effective preview target identities", () => {
  const deployment = cloudflarePagesDeploymentFixture({
    preview: cloudflarePagesPreviewFixture(),
  });
  const effectiveRunTarget = deriveCloudflarePagesPreviewTarget(deployment, "deploy-123");
  const record = createCloudflarePagesDeployRecord(deployment, {
    deployRunId: "deploy-456",
    operationKind: "deploy",
    runClassification: "deploy",
    publishMode: "preview",
    finalOutcome: "succeeded",
    artifactIdentity: "static-webapp:abc123",
    artifactLineageId: "static-webapp:abc123",
    deployBatchId: "batch-123",
    admittedContext: {
      lanePolicyRef: deployment.lanePolicyRef,
      lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
      admissionPolicyRef: deployment.admissionPolicyRef,
      admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
      environmentStage: deployment.environmentStage,
      source: {
        mode: "source_run_reuse",
        sourceRef: "env/pleomino/staging",
        sourceRevision: "abc123",
        artifactIdentity: "static-webapp:abc123",
        artifactTrustMode: "recorded_exact_artifact",
        sourceRunId: "deploy-123",
        sourceDeploymentId: deployment.deploymentId,
      },
      targetEnvironment: {
        mode: "stage_branch_snapshot",
        targetRef: "env/pleomino/staging",
        targetRevision: "abc123",
        providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
        lockScope: deployment.providerTarget.providerTargetIdentity,
      },
    },
    effectiveRunTarget,
    previewIdentitySelector: cloudflarePagesPreviewIdentitySelector("deploy-123"),
    executionPolicy: {
      smokeBudget: {
        runnerClass: "http_5m",
        totalBudgetMs: 300000,
        source: "component_kind_default",
      },
      retries: [
        {
          step: "smoke",
          maxRetries: 2,
          totalAttempts: 2,
          retriesUsed: 1,
          exhaustedBudget: false,
          attempts: [],
        },
      ],
    },
  });
  assert.equal(record.providerTargetIdentity, deployment.providerTarget.providerTargetIdentity);
  assert.equal(
    record.effectiveRunTarget.providerTargetIdentity,
    effectiveRunTarget.providerTargetIdentity,
  );
  assert.equal(record.deployBatchId, "batch-123");
  assert.equal(record.previewIdentitySelector?.sourceRunId, "deploy-123");
  assert.equal(record.publishMode, "preview");
  assert.equal(record.executionPolicy?.smokeBudget?.runnerClass, "http_5m");
  assert.equal(record.executionPolicy?.retries?.[0]?.retriesUsed, 1);
  assert.equal(record.runnerIdentities.publisher, deployment.publisher.type);
  assert.equal(record.runnerIdentities.smoke, "cloudflare-pages-static-webapp-smoke@1");
});
