#!/usr/bin/env zx-wrapper
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";
import type { OpenTofuApplyAdapter, OpenTofuApplyAdapterResult } from "./opentofu-apply";

export function createProductionOpenTofuApplyAdapter(
  opts: {
    binary?: string;
  } = {},
): OpenTofuApplyAdapter {
  const binary =
    (opts.binary || "").trim() ||
    (process.env.BNX_OPENTOFU_BIN || "").trim() ||
    (process.env.BNX_DEPLOY_OPENTOFU_BIN || "").trim() ||
    "tofu";
  return {
    async apply(args): Promise<OpenTofuApplyAdapterResult> {
      const commandArgs = ["apply", "-input=false", "-auto-approve", args.applyPlanPath];
      const run = await $({
        cwd: args.stackDirectory,
        stdio: "pipe",
        env: {
          ...scrubDeploymentSecretEnv(),
          ...args.credentialEnv,
          TF_IN_AUTOMATION: "1",
        },
      })`${binary} ${commandArgs}`.nothrow();
      return {
        command: {
          binary,
          args: commandArgs,
          workingDirectory: args.stackDirectory,
        },
        exitCode: Number((run as any).exitCode ?? 1),
        stdout: String((run as any).stdout || ""),
        stderr: String((run as any).stderr || ""),
      };
    },
  };
}
