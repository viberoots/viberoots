#!/usr/bin/env zx-wrapper
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import type {
  CloudflarePagesControlPlaneWorkerAuthority,
  CloudflarePagesPublishMode,
} from "./cloudflare-pages-control-plane-contract";
import type { CloudflarePagesPreviewIdentitySelector } from "./cloudflare-pages-preview";
import type { CloudflarePagesDeployment } from "./contract";
import type { CloudflarePagesOperationKind } from "./cloudflare-pages-records";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";

export type CloudflarePagesStaticDeployStep = "publish" | "smoke";

export type CloudflarePagesStaticSmokeRecord = {
  publicUrl?: string;
  smokeOutcome: "passed" | "failed_nonblocking" | "omitted_by_exception";
  smokeError?: string;
};

export type CloudflarePagesStaticDeployOptions = {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifact: AdmittedStaticWebappArtifact;
  recordsRoot: string;
  deployBatchId?: string;
  operationKind?: CloudflarePagesOperationKind;
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
  admittedContext: CloudflarePagesAdmittedContext;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  publishMode?: CloudflarePagesPublishMode;
  effectiveRunTarget?: CloudflarePagesDeployment["providerTarget"];
  previewIdentitySelector?: CloudflarePagesPreviewIdentitySelector;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
  progress?: {
    onStepStart?: (
      step: CloudflarePagesStaticDeployStep,
      metadata?: { timeoutMs?: number },
    ) => Promise<void> | void;
  };
  timeouts?: {
    publishMs?: number;
    smokeMs?: number;
  };
};
