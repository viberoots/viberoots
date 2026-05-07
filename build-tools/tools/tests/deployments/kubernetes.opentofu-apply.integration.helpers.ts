#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  OPENTOFU_STACK_PROVISIONER,
  type OpenTofuProvisionerMetadata,
} from "../../deployments/opentofu-stack";
import type {
  OpenTofuApplyAdapter,
  OpenTofuApplyAdapterResult,
} from "../../deployments/opentofu-apply";

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
    JSON.stringify({ plan_json: "plan.json", apply_plan: "plan.tfplan" }, null, 2) + "\n",
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
  await fsp.writeFile(path.join(baseDir, "plan.tfplan"), "saved opentofu plan fixture\n", "utf8");
}

export type IntegrationApplyCall = {
  planArtifactPath: string;
  applyPlanPath: string;
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
        applyPlanPath: args.applyPlanPath,
        credentialEnvNames: args.credentialEnvNames,
      });
      return {
        command: {
          binary: "tofu",
          args: ["apply", "-input=false", args.applyPlanPath],
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

export async function installFakeOpenTofu(tmp: string): Promise<{
  binPath: string;
  logPath: string;
}> {
  const binDir = path.join(tmp, "fake-opentofu-bin");
  const logPath = path.join(tmp, "fake-opentofu.log");
  const binPath = path.join(binDir, "tofu");
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(
    binPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf \'%s\\n\' "$PWD|$*|${opentofu_provider_credentials:-missing}" >> "$BNX_FAKE_OPENTOFU_LOG"',
      "printf '%s\\n' 'fake opentofu apply complete'",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(binPath, 0o755);
  return { binPath, logPath };
}

export async function writeOpenTofuSecretFixture(
  tmp: string,
  extraContracts: Record<string, unknown> = {},
): Promise<string> {
  const fixturePath = path.join(tmp, "opentofu-secrets.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({
      schemaVersion: "deployment-secret-fixture@1",
      contracts: {
        "secret://deployments/opentofu/provider": {
          value: INTEGRATION_SECRET_VALUE,
          allowedSteps: ["provision"],
          targetScopes: ["*"],
        },
        ...extraContracts,
      },
    }),
    "utf8",
  );
  return fixturePath;
}

export function reviewedOpenTofuSecretRequirements() {
  return [
    {
      name: "opentofu_provider_credentials",
      step: "provision" as const,
      contractId: "secret://deployments/opentofu/provider",
      required: true,
    },
  ];
}
