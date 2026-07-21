import { requireCloudflarePagesControlPlaneAuthority } from "./cloudflare-pages-control-plane-contract";
import {
  createCloudflarePagesDeployRecord,
  type CloudflarePagesOperationKind,
  type CloudflarePagesDeployRecord,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records";
import type { CloudflarePagesPublishMode } from "./cloudflare-pages-control-plane-contract";
import { executionPolicyWithRetry } from "./deployment-retry-records";
import type { CloudflarePagesStaticDeployOptions } from "./cloudflare-pages-static-deploy-options";

export async function writeFailedCloudflarePagesStaticDeploy(args: {
  opts: CloudflarePagesStaticDeployOptions;
  error: unknown;
  authority: ReturnType<typeof requireCloudflarePagesControlPlaneAuthority>;
  runId: string;
  operationKind: CloudflarePagesOperationKind;
  publishMode: CloudflarePagesPublishMode;
  effectiveRunTarget: CloudflarePagesStaticDeployOptions["deployment"]["providerTarget"];
  deploymentMetadataFingerprint: string;
  providerConfigFingerprint: string | undefined;
  replaySnapshotPath: string | undefined;
  executionPolicy: ReturnType<typeof executionPolicyWithRetry> | undefined;
}): Promise<never> {
  const failedStep =
    args.error &&
    typeof args.error === "object" &&
    "failedStep" in args.error &&
    args.error.failedStep === "smoke"
      ? "smoke"
      : "publish";
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  const record: CloudflarePagesDeployRecord = createCloudflarePagesDeployRecord(
    args.opts.deployment,
    {
      deployRunId: args.runId,
      operationKind: args.operationKind,
      runClassification: args.operationKind,
      publishMode: args.publishMode,
      finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      ...(args.opts.deployBatchId ? { deployBatchId: args.opts.deployBatchId } : {}),
      ...(args.opts.parentRunId ? { parentRunId: args.opts.parentRunId } : {}),
      ...(args.opts.releaseLineageId ? { releaseLineageId: args.opts.releaseLineageId } : {}),
      artifactIdentity: args.opts.artifact.identity,
      artifactStoredArtifactPath: args.opts.artifact.storedArtifactPath,
      artifactProvenancePath: args.opts.artifact.provenancePath,
      artifactLineageId: args.opts.artifactLineageId || args.opts.artifact.identity,
      admittedContext: args.opts.admittedContext,
      authority: args.authority,
      failedStep,
      effectiveRunTarget: args.effectiveRunTarget,
      ...(args.opts.previewIdentitySelector
        ? { previewIdentitySelector: args.opts.previewIdentitySelector }
        : {}),
      deploymentMetadataFingerprint: args.deploymentMetadataFingerprint,
      ...(args.executionPolicy ? { executionPolicy: args.executionPolicy } : {}),
      ...(args.providerConfigFingerprint
        ? { providerConfigFingerprint: args.providerConfigFingerprint }
        : {}),
      ...(args.replaySnapshotPath ? { replaySnapshotPath: args.replaySnapshotPath } : {}),
      error: message,
    },
  );
  const recordPath = await writeCloudflarePagesDeployRecord(args.opts.recordsRoot, record);
  throw Object.assign(args.error instanceof Error ? args.error : new Error(message), {
    record,
    recordPath,
  });
}
