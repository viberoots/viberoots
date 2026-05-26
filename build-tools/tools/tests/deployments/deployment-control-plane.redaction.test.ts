#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import { createCloudflarePagesDeployRecord } from "../../deployments/cloudflare-pages-records";
import { readDeploymentControlPlaneObservability } from "../../deployments/deployment-control-plane-observability";
import { createNixosSharedHostDeployRecord } from "../../deployments/nixos-shared-host-records";
import { runInTemp } from "../lib/test-helpers";

async function writeJson(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("record helpers redact secret-bearing error strings before durable persistence", () => {
  const nixosRecord = createNixosSharedHostDeployRecord(nixosSharedHostDeploymentFixture(), {
    deployRunId: "deploy-secret",
    runClassification: "deploy",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    error: "provider token sk_live_secret_123 leaked during publish",
  });
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-secret-cf",
    finalOutcome: "publish_failed",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:prod",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:prod",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "production",
      source: {
        mode: "reviewed_source_ref",
        sourceRef: "refs/tags/release/prod",
        sourceRevision: "abc123",
      },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "refs/tags/release/prod",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error: "Authorization: Bearer super-secret-token",
  });

  assert.ok(!String(nixosRecord.error).includes("sk_live_secret_123"));
  assert.ok(!String(cloudflareRecord.error).includes("super-secret-token"));
  assert.match(String(nixosRecord.errorFingerprint), /^sha256:/);
  assert.match(String(cloudflareRecord.errorFingerprint), /^sha256:/);
});

test("record helpers preserve known safe smoke diagnostics", () => {
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-smoke",
    finalOutcome: "smoke_failed_after_publish",
    failedStep: "smoke",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:staging",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:staging",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "staging",
      source: { mode: "reviewed_source_ref", sourceRef: "main", sourceRevision: "abc123" },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "main",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error:
      "smoke expected 200 from https://staging.pleomino.com/, got 522. Cloudflare returned 522 for custom domain staging.pleomino.com; the Pages project may be published while Cloudflare custom-domain routing is still activating. The deploy will keep retrying within its smoke budget, and if it still fails, check the Pages custom domain status and the CNAME for staging.pleomino.com -> pleomino-staging-pages.pages.dev.",
  });

  assert.match(
    String(cloudflareRecord.error),
    /smoke expected 200 from https:\/\/staging\.pleomino\.com\/, got 522/,
  );
  assert.equal(cloudflareRecord.errorFingerprint, undefined);
});

test("record helpers preserve known safe Cloudflare publish diagnostics", () => {
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-publish",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:prod",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:prod",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "production",
      source: {
        mode: "reviewed_source_ref",
        sourceRef: "refs/tags/release/prod",
        sourceRevision: "abc123",
      },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "refs/tags/release/prod",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error:
      "Cloudflare DNS record lookup failed: Authentication error [code: 10000]. Ensure the Cloudflare API token has Zone:DNS Read and Zone:DNS Edit scoped to zone zone-pleomino for pleomino.com.",
  });

  assert.match(String(cloudflareRecord.error), /Cloudflare DNS record lookup failed/);
  assert.match(String(cloudflareRecord.error), /Cloudflare API token has Zone:DNS Read/);
  assert.equal(cloudflareRecord.errorFingerprint, undefined);
});

test("record helpers still redact concrete token values in Cloudflare diagnostics", () => {
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-publish-secret",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:prod",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:prod",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "production",
      source: {
        mode: "reviewed_source_ref",
        sourceRef: "refs/tags/release/prod",
        sourceRevision: "abc123",
      },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "refs/tags/release/prod",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error: "Cloudflare DNS record lookup failed: token=cf-secret-value",
  });

  assert.ok(!String(cloudflareRecord.error).includes("cf-secret-value"));
  assert.match(String(cloudflareRecord.errorFingerprint), /^sha256:/);
});

test("record helpers preserve sanitized Wrangler Cloudflare API diagnostics", () => {
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-wrangler-safe",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:staging",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:staging",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "staging",
      source: { mode: "reviewed_source_ref", sourceRef: "main", sourceRevision: "abc123" },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "main",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error:
      "wrangler pages deploy failed: Cloudflare API /accounts/(account)/pages/projects/pleomino-staging-pages/deployments: Authentication error (status: 403) [code: 10000]",
  });

  assert.match(String(cloudflareRecord.error), /wrangler pages deploy failed/);
  assert.match(String(cloudflareRecord.error), /\/accounts\/\(account\)\//);
  assert.equal(cloudflareRecord.errorFingerprint, undefined);
});

test("record helpers sanitize noisy Wrangler diagnostics before display", () => {
  const cloudflareRecord = createCloudflarePagesDeployRecord(cloudflarePagesDeploymentFixture(), {
    deployRunId: "deploy-wrangler-noisy",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    admittedContext: {
      lanePolicyRef: "//build-tools/deployments/lanes:staging",
      lanePolicyFingerprint: "sha256:lane",
      admissionPolicyRef: "//build-tools/deployments/policies:staging",
      admissionPolicyFingerprint: "sha256:policy",
      environmentStage: "staging",
      source: { mode: "reviewed_source_ref", sourceRef: "main", sourceRevision: "abc123" },
      targetEnvironment: {
        mode: "reviewed_source_snapshot",
        targetRef: "main",
        targetRevision: "abc123",
        providerTargetIdentity: "target-cf",
        lockScope: "target-cf",
      },
    },
    error:
      "wrangler pages deploy failed: Cloudflare API /accounts/1b911846f80a89272c0dbaf44f5c810f/pages/projects/pleomino-staging-pages: token does not have Pages write permission!",
  });

  assert.match(String(cloudflareRecord.error), /\/accounts\/\(account\)\//);
  assert.match(String(cloudflareRecord.error), /token does not have Pages write permission/);
  assert.ok(!String(cloudflareRecord.error).includes("1b911846f80a89272c0dbaf44f5c810f"));
  assert.equal(cloudflareRecord.errorFingerprint, undefined);
});

test("observability views keep referenced artifacts secret-safe by exposing reference-only payloads", async () => {
  await runInTemp("deployment-control-plane-redaction", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const replayPath = path.join(recordsRoot, "replay", "deploy-1", "snapshot.json");
    const runPath = path.join(recordsRoot, "runs", "deploy-1.json");
    await writeJson(replayPath, {
      rawProviderOutput: "password=hunter2",
      approvalEvidence: "apiKey=abc123",
    });
    await writeJson(runPath, {
      deployRunId: "deploy-1",
      deploymentId: "deploy-redacted",
      deploymentLabel: "//projects/deployments/redacted:deploy",
      providerTargetIdentity: "target-redacted",
      finalOutcome: "publish_failed",
      failedStep: "publish",
      replaySnapshotPath: replayPath,
      error: "publish redacted (sha256:error-redacted)",
      errorFingerprint: "sha256:error-redacted",
    });

    const observability = await readDeploymentControlPlaneObservability(recordsRoot);
    const rendered = JSON.stringify(observability);

    assert.ok(!rendered.includes("hunter2"));
    assert.ok(!rendered.includes("abc123"));
    assert.equal(
      observability.views.runs[0]?.operatorArtifacts[0]?.classification,
      "reference_only",
    );
    assert.match(
      String(observability.views.runs[0]?.operatorArtifacts[0]?.fingerprint),
      /^sha256:/,
    );
  });
});
