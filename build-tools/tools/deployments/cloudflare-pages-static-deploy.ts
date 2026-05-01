#!/usr/bin/env zx-wrapper
import path from "node:path";
import { requireCloudflarePagesControlPlaneAuthority } from "./cloudflare-pages-control-plane-contract.ts";
import { prepareCloudflarePagesWranglerConfig } from "./cloudflare-pages-config.ts";
import { ensureCloudflarePagesCustomDomain } from "./cloudflare-pages-custom-domain.ts";
import { publishCloudflarePagesStaticWebapp } from "./cloudflare-pages-publisher.ts";
import {
  createCloudflarePagesDeployRecord,
  createCloudflarePagesDeployRunId,
  type CloudflarePagesDeployRecord,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
import { writeCloudflarePagesReplaySnapshot } from "./cloudflare-pages-replay.ts";
import {
  effectiveCloudflarePagesSmokeTimeoutMs,
  maxCloudflarePagesCustomDomainSmokeRetries,
  shouldUseCloudflarePagesCustomDomainSmokeBudget,
} from "./cloudflare-pages-smoke-retries.ts";
import { smokeCloudflarePagesStaticWebapp } from "./cloudflare-pages-static-smoke.ts";
import { withFailedStep } from "./deployment-failed-step.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import {
  classifySmokeRetry,
  noPublishAutoRetry,
  runWithAutomaticRetry,
} from "./deployment-retry-policy.ts";
import { executionPolicyWithRetry, retryAuditFrom } from "./deployment-retry-records.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers.ts";
import { requireAdmittedStaticWebappArtifactPath } from "./static-webapp-artifacts.ts";
import type {
  CloudflarePagesStaticDeployOptions,
  CloudflarePagesStaticSmokeRecord,
} from "./cloudflare-pages-static-deploy-options.ts";

export async function runCloudflarePagesStaticDeploy(
  opts: CloudflarePagesStaticDeployOptions,
): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const authority = requireCloudflarePagesControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createCloudflarePagesDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  const publishMode = opts.publishMode || "normal";
  const effectiveRunTarget = opts.effectiveRunTarget || opts.deployment.providerTarget;
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const smokeMode = resolveDeploymentSmokeExecutionMode({
    deployment: opts.deployment,
    publishMode,
  });
  const secretRuntime = createVaultDeploymentSecretRuntime({
    admittedContext: opts.admittedContext,
  });
  let providerConfigFingerprint: string | undefined;
  let replaySnapshotPath: string | undefined;
  let executionPolicy: ReturnType<typeof executionPolicyWithRetry> | undefined;
  try {
    const artifactDir = await requireAdmittedStaticWebappArtifactPath(opts.artifact);
    await opts.progress?.onStepStart?.("publish", {
      ...(opts.timeouts?.publishMs ? { timeoutMs: opts.timeouts.publishMs } : {}),
    });
    if (publishMode === "normal" && opts.deployment.providerTarget.customDomain) {
      const provisionSecrets = await secretRuntime.enterStep("provision");
      await ensureCloudflarePagesCustomDomain({
        deployment: opts.deployment,
        apiToken: provisionSecrets.cloudflare_api_token,
      }).catch((error) => {
        throw withFailedStep("publish", error);
      });
    }
    const publishSecrets = await secretRuntime.enterStep("publish");
    const apiToken = publishSecrets.cloudflare_api_token?.trim() || undefined;
    const preparedConfig = await prepareCloudflarePagesWranglerConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      outputPath: path.join(opts.recordsRoot, "provider-config", `${runId}.wrangler.json`),
    }).catch((error) => {
      throw withFailedStep("publish", error);
    });
    providerConfigFingerprint = preparedConfig.fingerprint;
    ({ replaySnapshotPath } = await writeCloudflarePagesReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      admittedContext: opts.admittedContext,
      providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
      ...(authority.recordExecutionSnapshotPath
        ? { controlPlaneExecutionSnapshotPath: authority.recordExecutionSnapshotPath }
        : {}),
    }));
    const published = await runWithAutomaticRetry({
      step: "publish",
      run: async () =>
        await publishCloudflarePagesStaticWebapp({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactDir,
          renderedConfigPath: preparedConfig.renderedConfigPath,
          effectiveRunTarget,
          apiToken,
          ...(opts.timeouts?.publishMs ? { timeoutMs: opts.timeouts.publishMs } : {}),
        }),
      classifyError: () => noPublishAutoRetry(),
      ...(opts.timeouts?.publishMs ? { totalBudgetMs: opts.timeouts.publishMs } : {}),
    })
      .then((result) => {
        executionPolicy = executionPolicyWithRetry({
          budget: smokeMode.budget,
          retryAudit: result.audit,
        });
        return result.result;
      })
      .catch((error) => {
        executionPolicy = executionPolicyWithRetry({
          budget: smokeMode.budget,
          retryAudit: retryAuditFrom(error),
        });
        throw withFailedStep("publish", error);
      });
    let smoke: CloudflarePagesStaticSmokeRecord | undefined;
    if (smokeMode.mode === "omitted") {
      smoke = {
        publicUrl: effectiveRunTarget.canonicalUrl,
        smokeOutcome: "omitted_by_exception",
      };
      executionPolicy = executionPolicyWithRetry({
        budget: smokeMode.budget,
        prior: executionPolicy,
      });
    } else {
      try {
        const smokeTimeoutMs = effectiveCloudflarePagesSmokeTimeoutMs({
          workerTimeoutMs: opts.timeouts?.smokeMs,
          policyBudgetMs: smokeMode.budget.totalBudgetMs,
        });
        await opts.progress?.onStepStart?.("smoke", {
          ...(smokeTimeoutMs ? { timeoutMs: smokeTimeoutMs } : {}),
        });
        await secretRuntime.enterStep("smoke");
        const completedSmoke = await runWithAutomaticRetry({
          step: "smoke",
          totalBudgetMs: smokeTimeoutMs,
          ...(shouldUseCloudflarePagesCustomDomainSmokeBudget({
            effectiveRunTarget,
          })
            ? { maxRetries: maxCloudflarePagesCustomDomainSmokeRetries(smokeTimeoutMs) }
            : {}),
          run: async () =>
            await smokeCloudflarePagesStaticWebapp({
              deployment: opts.deployment,
              indexPath: path.join(artifactDir, "index.html"),
              effectiveRunTarget,
              publishedPublicUrl: published.publicUrl,
              connectOverride: opts.smokeConnectOverride,
            }),
          classifyError: classifySmokeRetry,
        });
        executionPolicy = executionPolicyWithRetry({
          budget: smokeMode.budget,
          prior: executionPolicy,
          retryAudit: completedSmoke.audit,
        });
        smoke = { publicUrl: completedSmoke.result.publicUrl, smokeOutcome: "passed" };
      } catch (error) {
        executionPolicy = executionPolicyWithRetry({
          budget: smokeMode.budget,
          prior: executionPolicy,
          retryAudit: retryAuditFrom(error),
        });
        if (smokeMode.mode !== "nonblocking") {
          throw withFailedStep("smoke", error);
        }
        smoke = {
          publicUrl: effectiveRunTarget.canonicalUrl,
          smokeOutcome: "failed_nonblocking",
          smokeError: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const record = createCloudflarePagesDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      publishMode,
      finalOutcome: "succeeded",
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      admittedContext: opts.admittedContext,
      authority,
      effectiveRunTarget,
      ...(opts.previewIdentitySelector
        ? { previewIdentitySelector: opts.previewIdentitySelector }
        : {}),
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      ...(smoke?.smokeOutcome ? { smokeOutcome: smoke.smokeOutcome } : {}),
      ...(smokeMode.smokeException ? { smokeException: smokeMode.smokeException } : {}),
      ...(smoke?.smokeError ? { smokeError: smoke.smokeError } : {}),
      ...(executionPolicy ? { executionPolicy } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      publicUrl: smoke.publicUrl,
      ...(published.providerReleaseId ? { providerReleaseId: published.providerReleaseId } : {}),
    });
    return {
      record,
      recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record),
    };
  } catch (error) {
    const failedStep =
      error && typeof error === "object" && "failedStep" in error && error.failedStep === "smoke"
        ? "smoke"
        : "publish";
    const message = error instanceof Error ? error.message : String(error);
    const record = createCloudflarePagesDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      publishMode,
      finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      admittedContext: opts.admittedContext,
      authority,
      failedStep,
      effectiveRunTarget,
      ...(opts.previewIdentitySelector
        ? { previewIdentitySelector: opts.previewIdentitySelector }
        : {}),
      deploymentMetadataFingerprint,
      ...(executionPolicy ? { executionPolicy } : {}),
      ...(providerConfigFingerprint ? { providerConfigFingerprint } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      error: message,
    });
    const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
