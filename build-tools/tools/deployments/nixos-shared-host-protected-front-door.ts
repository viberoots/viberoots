#!/usr/bin/env zx-wrapper
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components.ts";
import { runNixosSharedHostDirectServiceMutation } from "./nixos-shared-host-control-plane-service-front-door.ts";
import { resolveServiceClientFromFlags } from "./nixos-shared-host-service-client-config.ts";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs.ts";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client.ts";

const SERVICE_ONLY_LOCAL_FLAGS = [
  "host-root",
  "state",
  "records-root",
  "host-config-out",
  "control-plane-database-url",
] as const;

function rejectServiceOnlyLocalFlags(hasFlag: (flag: string) => boolean) {
  const conflicts = SERVICE_ONLY_LOCAL_FLAGS.filter((flag) => hasFlag(flag));
  if (conflicts.length === 0) return;
  throw new Error(
    `service-only nixos-shared-host deploy does not support ${conflicts.map((flag) => `--${flag}`).join(", ")}`,
  );
}

export async function runProtectedNixosSharedHostDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  remove: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  remote?: string;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag);
  if (opts.publishOnly && !opts.sourceRunId) {
    throw new Error(
      opts.rollback
        ? "shared rollback requires --source-run-id"
        : "shared --publish-only requires --source-run-id to select an admitted run",
    );
  }
  if (opts.publishOnly && opts.artifactDirFlag) {
    throw new Error(
      "shared --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  if (opts.provisionOnly && opts.artifactDirFlag) {
    throw new Error(
      "nixos-shared-host --provision-only must not use --artifact-dir; default metadata-only runs do not load artifacts, and immutable reuse must be selected with --source-run-id",
    );
  }
  const serviceClient = resolveServiceClientFromFlags({
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    remote: opts.remote,
    context: `nixos-shared-host ${opts.deployment.protectionClass} mutation`,
  });
  const result = opts.remove
    ? await runNixosSharedHostDirectServiceMutation({
        controlPlaneUrl: serviceClient.controlPlaneUrl,
        ...(serviceClient.controlPlaneToken
          ? { controlPlaneToken: serviceClient.controlPlaneToken }
          : {}),
        deployment: opts.deployment,
        operationKind: "explicit_removal",
        ...(await authSession(opts, serviceClient, "explicit_removal")),
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      })
    : opts.provisionOnly
      ? await runNixosSharedHostDirectServiceMutation({
          controlPlaneUrl: serviceClient.controlPlaneUrl,
          ...(serviceClient.controlPlaneToken
            ? { controlPlaneToken: serviceClient.controlPlaneToken }
            : {}),
          deployment: opts.deployment,
          operationKind: "provision_only",
          ...(await authSession(opts, serviceClient, "provision_only")),
          publishBehavior: "provision-only",
          ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
          ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
          ...(opts.smokeConnectOverride
            ? { smokeConnectOverride: opts.smokeConnectOverride as any }
            : {}),
        })
      : opts.publishOnly
        ? await runNixosSharedHostDirectServiceMutation({
            controlPlaneUrl: serviceClient.controlPlaneUrl,
            ...(serviceClient.controlPlaneToken
              ? { controlPlaneToken: serviceClient.controlPlaneToken }
              : {}),
            deployment: opts.deployment,
            operationKind: opts.rollback ? "rollback" : "promotion",
            ...(await authSession(opts, serviceClient, opts.rollback ? "rollback" : "promotion")),
            publishBehavior: "publish-only",
            sourceRunId: opts.sourceRunId,
            ...(opts.rollback ? { rollback: true } : {}),
            ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
            ...(opts.smokeConnectOverride
              ? { smokeConnectOverride: opts.smokeConnectOverride as any }
              : {}),
          })
        : await runNixosSharedHostDirectServiceMutation({
            controlPlaneUrl: serviceClient.controlPlaneUrl,
            ...(serviceClient.controlPlaneToken
              ? { controlPlaneToken: serviceClient.controlPlaneToken }
              : {}),
            deployment: opts.deployment,
            operationKind: "deploy",
            ...(await authSession(opts, serviceClient, "deploy")),
            ...(isMultiComponentNixosSharedHostDeployment(opts.deployment)
              ? {
                  artifactDirsByComponentId: await resolveComponentArtifactDirsForCli(
                    opts.workspaceRoot,
                    opts.deployment,
                  ),
                }
              : {
                  artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment),
                }),
            ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
            ...(opts.smokeConnectOverride
              ? { smokeConnectOverride: opts.smokeConnectOverride as any }
              : {}),
          });
  return result.kind === "result" ? summarizeDeploymentResult(result.result as any) : result.status;
}

async function authSession(
  opts: Parameters<typeof runProtectedNixosSharedHostDeployFrontDoor>[0],
  serviceClient: ReturnType<typeof resolveServiceClientFromFlags>,
  operationKind: string,
) {
  if (
    !shouldUseServiceOwnedInteractiveAuth({
      deployment: opts.deployment,
      inputs: opts.vaultRuntimeInputs,
    })
  ) {
    return {};
  }
  return {
    authSessionId: await createAndWaitForServiceOwnedAuthSession({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...(serviceClient.controlPlaneToken
        ? { controlPlaneToken: serviceClient.controlPlaneToken }
        : {}),
      deployment: opts.deployment,
      operationKind,
      inputs: opts.vaultRuntimeInputs,
    }),
  };
}
