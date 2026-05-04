#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  OPENTOFU_STACK_PROVISIONER,
  type OpenTofuProvisionerMetadata,
} from "../../deployments/opentofu-stack.ts";
import type {
  OpenTofuApplyAdapter,
  OpenTofuApplyAdapterResult,
} from "../../deployments/opentofu-apply.ts";

export const INTEGRATION_SECRET_VALUE = "vault:secret/opentofu/integration";

export function openTofuProvisioner(): OpenTofuProvisionerMetadata {
  return {
    type: OPENTOFU_STACK_PROVISIONER,
    config: "opentofu/stack.json",
    stackDirectory: "opentofu",
    stackIdentity: "foundation/integration",
    stateBackendIdentity: "s3://state-integration/foundation",
    allowedEnvironmentDifferences: [],
  };
}

export async function writeOpenTofuStackFixture(opts: {
  workspaceRoot: string;
  deploymentId: string;
  actions?: string[];
}): Promise<void> {
  const baseDir = path.join(
    opts.workspaceRoot,
    "projects",
    "deployments",
    opts.deploymentId,
    "opentofu",
  );
  await fsp.mkdir(baseDir, { recursive: true });
  await fsp.writeFile(
    path.join(baseDir, "stack.json"),
    JSON.stringify({ plan_json: "plan.json" }, null, 2) + "\n",
    "utf8",
  );
  const actions = opts.actions || ["create"];
  await fsp.writeFile(
    path.join(baseDir, "plan.json"),
    JSON.stringify(
      {
        resource_changes: actions.map((action) => ({ change: { actions: [action] } })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export type IntegrationApplyCall = {
  planArtifactPath: string;
  credentialEnvNames: string[];
};

export function recordingApplyAdapter(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): { adapter: OpenTofuApplyAdapter; calls: IntegrationApplyCall[] } {
  const calls: IntegrationApplyCall[] = [];
  const adapter: OpenTofuApplyAdapter = {
    async apply(args): Promise<OpenTofuApplyAdapterResult> {
      calls.push({
        planArtifactPath: args.planArtifactPath,
        credentialEnvNames: args.credentialEnvNames,
      });
      return {
        command: {
          binary: "tofu",
          args: ["apply", "-input=false", args.planArtifactPath],
          workingDirectory: args.stackDirectory,
        },
        exitCode: opts.exitCode ?? 0,
        ...(opts.stdout ? { stdout: opts.stdout } : {}),
        ...(opts.stderr ? { stderr: opts.stderr } : {}),
      };
    },
  };
  return { adapter, calls };
}

export function fakeProvisionSecretRuntime(values: Record<string, string>) {
  return () => ({
    async enterStep(_step: "provision") {
      return values;
    },
  });
}
