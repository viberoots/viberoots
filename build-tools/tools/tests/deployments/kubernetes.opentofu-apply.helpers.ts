#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  OPENTOFU_STACK_PROVISIONER,
  type OpenTofuProvisionerMetadata,
} from "../../deployments/opentofu-stack";
import type { OpenTofuApplyAdapter } from "../../deployments/opentofu-apply";

export const PLAN_FINGERPRINT = "sha256:plan";
export const STACK_CONFIG_FINGERPRINT = "sha256:stack-config";
export const STACK_IDENTITY = "foundation/prod";
export const STATE_BACKEND_IDENTITY = "s3://state-prod/foundation";

export function provisionerMetadata(
  overrides: Partial<OpenTofuProvisionerMetadata> = {},
): OpenTofuProvisionerMetadata {
  return {
    type: OPENTOFU_STACK_PROVISIONER,
    config: "opentofu/stack.json",
    stackDirectory: "opentofu",
    stackIdentity: STACK_IDENTITY,
    stateBackendIdentity: STATE_BACKEND_IDENTITY,
    allowedEnvironmentDifferences: [],
    ...overrides,
  };
}

export async function writePlanArtifact(opts: {
  artifactPath: string;
  actions?: string[];
  planFingerprint?: string;
  stackConfigFingerprint?: string;
}): Promise<void> {
  const actions = opts.actions || ["create"];
  await fsp.mkdir(path.dirname(opts.artifactPath), { recursive: true });
  await fsp.writeFile(
    opts.artifactPath,
    JSON.stringify(
      {
        schemaVersion: "kubernetes-provisioner-plan@1",
        provisionerType: OPENTOFU_STACK_PROVISIONER,
        opentofu: {
          configPath: "opentofu/stack.json",
          planPath: "opentofu/plan.json",
          stackDirectory: "opentofu",
          stackIdentity: STACK_IDENTITY,
          stateBackendIdentity: STATE_BACKEND_IDENTITY,
          stackConfigFingerprint: opts.stackConfigFingerprint || STACK_CONFIG_FINGERPRINT,
          planFingerprint: opts.planFingerprint || PLAN_FINGERPRINT,
          summary: {
            mutationClass: actions.every((action) => action === "no-op")
              ? "no_op"
              : "non_destructive",
            resourceChangeCount: actions.length,
            actions,
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export type RecordingAdapterCall = {
  planArtifactPath: string;
  stackDirectory: string;
  stateBackendIdentity: string;
  credentialEnvNames: string[];
};

export function recordingAdapter(
  opts: { exitCode?: number; stdout?: string; stderr?: string } = {},
) {
  const calls: RecordingAdapterCall[] = [];
  const adapter: OpenTofuApplyAdapter = {
    async apply(args) {
      calls.push(args);
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

export function fakeSecretRuntime(values: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      async enterStep(step: "provision") {
        calls.push(step);
        return values;
      },
    },
  };
}

export function throwingSecretRuntime(message: string) {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      async enterStep(step: "provision") {
        calls.push(step);
        throw new Error(message);
      },
    },
  };
}

export async function setupArtifact(tmp: string, name: string, actions?: string[]) {
  const artifactPath = path.join(tmp, `${name}.json`);
  await writePlanArtifact({ artifactPath, ...(actions ? { actions } : {}) });
  return {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
}
