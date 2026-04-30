#!/usr/bin/env zx-wrapper
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import type {
  CloudflarePagesControlPlaneWorkerAuthority,
  CloudflarePagesPublishMode,
} from "./cloudflare-pages-control-plane-contract.ts";
import type { CloudflarePagesPreviewIdentitySelector } from "./cloudflare-pages-preview.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import type { CloudflarePagesOperationKind } from "./cloudflare-pages-records.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";

export type CloudflarePagesStaticDeployStep = "publish" | "smoke";

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
