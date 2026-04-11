#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { submitNixosSharedHostControlPlaneViaService } from "./nixos-shared-host-control-plane-client.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract.ts";
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot.ts";
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract.ts";

export type NixosSharedHostServiceFrontDoorResponse =
  | {
      kind: "result";
      result: {
        record: any;
        recordPath: string;
      };
    }
  | {
      kind: "status";
      status: DeploymentControlPlaneStatus;
    };

async function finalizeServiceResponse(status: DeploymentControlPlaneStatus) {
  if (!status.resultRecordPath) {
    return {
      kind: "status" as const,
      status,
    };
  }
  const recordPath = path.resolve(status.resultRecordPath);
  return {
    kind: "result" as const,
    result: {
      record: JSON.parse(await fsp.readFile(recordPath, "utf8")),
      recordPath,
    },
  };
}

export async function runNixosSharedHostDirectServiceMutation(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployment: NixosSharedHostDeployment;
  operationKind: "deploy" | "explicit_removal";
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  const request: NixosSharedHostControlPlaneSubmitRequest = {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createNixosSharedHostSubmissionId(),
    submittedAt: new Date().toISOString(),
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    ...(opts.artifactDir ? { artifactDir: path.resolve(opts.artifactDir) } : {}),
    ...(opts.artifactDirsByComponentId
      ? {
          artifactDirsByComponentId: Object.fromEntries(
            Object.entries(opts.artifactDirsByComponentId).map(([key, value]) => [
              key,
              path.resolve(value),
            ]),
          ),
        }
      : {}),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
  const { final } = await submitNixosSharedHostControlPlaneViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    token: opts.controlPlaneToken,
    request,
  });
  return await finalizeServiceResponse(final);
}
