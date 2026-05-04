#!/usr/bin/env zx-wrapper
import type { CloudflarePagesControlPlaneSubmitRequest } from "./cloudflare-pages-control-plane-api-contract";
import type { CloudflarePagesArtifactInput } from "./cloudflare-pages-artifact-input";
import type { CloudflarePagesSmokeConnectOverride } from "./cloudflare-pages-control-plane-contract";
import {
  findLatestCloudflarePagesPreviewRecord,
  resolveCloudflarePagesPreviewSelection,
} from "./cloudflare-pages-preview-source";
import {
  resolveCloudflarePagesPromotionSelection,
  resolveCloudflarePagesPromotionSourceSelection,
} from "./cloudflare-pages-promotion";
import { resolveCloudflarePagesRollbackSelection } from "./cloudflare-pages-rollback";
import {
  requireTargetException,
  validateTransitionRequest,
  type CloudflarePagesTargetTransitionOperationKind,
} from "./cloudflare-pages-target-transition";
import type { DeploymentTargetException } from "./deployment-target-exceptions";

type RequestCommon = {
  request: CloudflarePagesControlPlaneSubmitRequest;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
};

export type ResolvedCloudflarePagesServiceSubmitRequest =
  | (RequestCommon & {
      kind: "deploy";
      artifactInput: CloudflarePagesArtifactInput;
    })
  | (RequestCommon & {
      kind: "promotion";
      artifactInput?: CloudflarePagesArtifactInput;
      operationKind: "promotion";
      parentRunId: string;
      releaseLineageId: string;
      artifactLineageId: string;
      source: {
        record: any;
        recordPath?: string;
        replaySnapshotPath: string;
      };
      artifact?: any;
    })
  | (RequestCommon & {
      kind: "rollback";
      selection: Awaited<ReturnType<typeof resolveCloudflarePagesRollbackSelection>>;
    })
  | (RequestCommon & {
      kind: "preview";
      selection: Awaited<ReturnType<typeof resolveCloudflarePagesPreviewSelection>>;
    })
  | (RequestCommon & {
      kind: "preview_cleanup";
      selection: Awaited<ReturnType<typeof resolveCloudflarePagesPreviewSelection>>;
      latestPreview?: Awaited<ReturnType<typeof findLatestCloudflarePagesPreviewRecord>>;
    })
  | (RequestCommon & {
      kind: "target_transition";
      operationKind: CloudflarePagesTargetTransitionOperationKind;
      targetException: DeploymentTargetException;
    });

function requireArtifactInput(
  request: CloudflarePagesControlPlaneSubmitRequest,
): CloudflarePagesArtifactInput {
  if (request.artifactDir) {
    throw new Error(
      "cloudflare-pages protected/shared submissions must use artifactInput; laptop-local artifactDir is not admitted",
    );
  }
  if (!request.artifactInput) {
    throw new Error(
      `cloudflare-pages ${request.operationKind} submission requires an artifactInput descriptor`,
    );
  }
  return request.artifactInput;
}

function requireSourceRunId(request: CloudflarePagesControlPlaneSubmitRequest, message: string) {
  const sourceRunId = String(request.sourceRunId || "").trim();
  if (!sourceRunId) throw new Error(message);
  return sourceRunId;
}

function requireNoArtifactDir(request: CloudflarePagesControlPlaneSubmitRequest, message: string) {
  if (String(request.artifactDir || "").trim()) throw new Error(message);
}

export async function resolveCloudflarePagesServiceSubmitRequest(
  request: CloudflarePagesControlPlaneSubmitRequest,
  opts: {
    workspaceRoot: string;
    recordsRoot: string;
    backendDatabaseUrl: string;
  },
): Promise<ResolvedCloudflarePagesServiceSubmitRequest> {
  if (request.operationKind === "preview_cleanup") {
    const sourceRunId = requireSourceRunId(
      request,
      "cloudflare-pages --preview-cleanup requires --source-run-id to identify the preview slot",
    );
    const selection = await resolveCloudflarePagesPreviewSelection({
      deployment: request.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    return {
      kind: "preview_cleanup",
      request,
      selection,
      latestPreview: await findLatestCloudflarePagesPreviewRecord({
        recordsRoot: opts.recordsRoot,
        deployment: request.deployment,
        sourceRunId,
        backendDatabaseUrl: opts.backendDatabaseUrl,
      }),
    };
  }
  if (request.operationKind === "retire_target" || request.operationKind === "migrate_target") {
    const targetExceptionRef = String(request.targetExceptionRef || "").trim();
    if (!targetExceptionRef) {
      throw new Error("--retire-target/--migrate-target requires --target-exception-ref");
    }
    const targetException = requireTargetException(request.deployment, targetExceptionRef);
    validateTransitionRequest({
      deployment: request.deployment,
      operationKind: request.operationKind,
      exception: targetException,
    });
    return {
      kind: "target_transition",
      request,
      operationKind: request.operationKind,
      targetException,
    };
  }
  if (request.publishMode === "preview") {
    const sourceRunId = requireSourceRunId(
      request,
      "cloudflare-pages --preview requires --source-run-id for protected/shared preview publication",
    );
    requireNoArtifactDir(
      request,
      "cloudflare-pages --preview must not use --artifact-dir; preview the admitted exact artifact selected by --source-run-id",
    );
    return {
      kind: "preview",
      request,
      selection: await resolveCloudflarePagesPreviewSelection({
        deployment: request.deployment,
        recordsRoot: opts.recordsRoot,
        sourceRunId,
        backendDatabaseUrl: opts.backendDatabaseUrl,
      }),
    };
  }
  if (request.operationKind === "rollback") {
    requireNoArtifactDir(
      request,
      "cloudflare-pages --publish-only --rollback must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
    return {
      kind: "rollback",
      request,
      selection: await resolveCloudflarePagesRollbackSelection({
        deployment: request.deployment,
        recordsRoot: opts.recordsRoot,
        sourceRunId: requireSourceRunId(
          request,
          "cloudflare-pages rollback requires --source-run-id",
        ),
        backendDatabaseUrl: opts.backendDatabaseUrl,
      }),
    };
  }
  if (request.operationKind === "promotion" && request.publishBehavior === "publish-only") {
    const sourceRunId = requireSourceRunId(
      request,
      "cloudflare-pages --publish-only requires --source-run-id to select a promotion source run",
    );
    requireNoArtifactDir(
      request,
      "cloudflare-pages --publish-only must not use --artifact-dir; promote the admitted exact artifact with --source-run-id",
    );
    const promotion = await resolveCloudflarePagesPromotionSelection({
      workspaceRoot: opts.workspaceRoot,
      deployment: request.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    return {
      kind: "promotion",
      request,
      operationKind: "promotion",
      parentRunId: promotion.parentRunId,
      releaseLineageId: promotion.releaseLineageId,
      artifactLineageId: promotion.artifactLineageId,
      source: {
        record: promotion.sourceRecord,
        ...(promotion.sourceRecordPath ? { recordPath: promotion.sourceRecordPath } : {}),
        replaySnapshotPath: promotion.sourceReplaySnapshotPath,
      },
      artifact: promotion.artifact,
    };
  }
  if (request.operationKind === "promotion") {
    const sourceRunId = requireSourceRunId(
      request,
      "cloudflare-pages rebuild-per-stage promotion requires --source-run-id",
    );
    const promotion = await resolveCloudflarePagesPromotionSourceSelection({
      workspaceRoot: opts.workspaceRoot,
      deployment: request.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    return {
      kind: "promotion",
      request,
      artifactInput: requireArtifactInput(request),
      operationKind: "promotion",
      parentRunId: promotion.parentRunId,
      releaseLineageId: promotion.releaseLineageId,
      artifactLineageId: promotion.artifactLineageId,
      source: {
        record: promotion.sourceRecord,
        ...(promotion.sourceRecordPath ? { recordPath: promotion.sourceRecordPath } : {}),
        replaySnapshotPath: promotion.sourceReplaySnapshotPath,
      },
    };
  }
  return {
    kind: "deploy",
    request,
    artifactInput: requireArtifactInput(request),
  };
}
