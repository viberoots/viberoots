#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";
import { runNodeWithZx } from "../lib/node-run.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env.ts";
import {
  REMOTE_SSH_IDENTITY_FILE_ENV,
  REMOTE_SSH_KNOWN_HOSTS_FILE_ENV,
} from "./nixos-shared-host-remote-ssh.ts";
import {
  JENKINS_DEPLOY_SCHEMA_VERSION,
  JenkinsDeployError,
  type JenkinsContext,
  createJenkinsEnvelope,
} from "./nixos-shared-host-jenkins-contract.ts";
import type { NixosSharedHostRemoteDeploySummary } from "./nixos-shared-host-remote-execution.ts";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";

const UNSUPPORTED_FLAGS = [
  "deployment-json",
  "destination",
  "remote-repo-path",
  "remote-state-path",
  "remote-runtime-root",
  "remote-records-root",
  "ssh-mode",
  "host-root",
  "state",
  "records-root",
  "host-config-out",
  "control-plane-url",
  "control-plane-token",
  "remove",
  "dry-run",
] as const;

function requireFlagValue(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new JenkinsDeployError("missing_required_flag", `missing required --${name}`);
  return value;
}

function requireNoUnsupportedFlags() {
  const hit = UNSUPPORTED_FLAGS.filter((flag) => hasFlag(flag));
  if (hit.length > 0) {
    throw new JenkinsDeployError(
      "unsupported_flag",
      `unsupported Jenkins wrapper flags: ${hit.map((flag) => `--${flag}`).join(", ")}`,
    );
  }
}

function assertNoHostApplyFlags() {
  const applyHost = getFlagBool("apply-host");
  const dryRun = getFlagBool("apply-host-dry-run");
  if (applyHost && dryRun) {
    throw new JenkinsDeployError(
      "incompatible_flags",
      "--apply-host and --apply-host-dry-run cannot be combined",
    );
  }
  if (applyHost || dryRun) {
    throw new JenkinsDeployError(
      "unsupported_flag",
      "service-only Jenkins wrapper does not support --apply-host or --apply-host-dry-run",
    );
  }
}

async function requireExistingPath(flagName: string, kind: "file" | "directory"): Promise<string> {
  const abs = path.resolve(requireFlagValue(flagName));
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new JenkinsDeployError(
      `missing_${flagName.replace(/-/g, "_")}`,
      `${kind} not found for --${flagName}: ${abs}`,
    );
  }
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
    throw new JenkinsDeployError(
      `invalid_${flagName.replace(/-/g, "_")}`,
      `expected ${kind} for --${flagName}: ${abs}`,
    );
  }
  return abs;
}

function smokeOverrideArgs(): string[] {
  const host = getFlagStr("smoke-connect-host", "").trim();
  const port = getFlagStr("smoke-connect-port", "").trim();
  const protocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  const anyOverride = host || port || hasFlag("smoke-connect-protocol");
  if (!anyOverride) return [];
  if (!host || !port) {
    throw new JenkinsDeployError(
      "invalid_smoke_override",
      "--smoke-connect-host and --smoke-connect-port are required together",
    );
  }
  return [
    "--smoke-connect-host",
    host,
    "--smoke-connect-port",
    port,
    "--smoke-connect-protocol",
    protocol === "http:" ? "http:" : "https:",
  ];
}

async function parseJson<T>(stdout: string, source: string): Promise<T> {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new JenkinsDeployError(
      "invalid_child_json",
      `${source} returned invalid JSON: ${stdout.trim()}`,
    );
  }
}

async function runDeployChild<T>(
  ctx: JenkinsContext,
  args: string[],
  source: "plan" | "deploy",
): Promise<T> {
  try {
    const { stdout } = await runNodeWithZx({
      script: path.join(ctx.repoRoot, "build-tools/tools/deployments/deploy.ts"),
      args,
      cwd: process.cwd(),
      env: {
        ...scrubDeploymentSecretEnv(),
        [REMOTE_SSH_IDENTITY_FILE_ENV]: ctx.sshIdentityFile,
        [REMOTE_SSH_KNOWN_HOSTS_FILE_ENV]: ctx.sshKnownHostsFile,
      },
      zxInitPath: path.join(ctx.repoRoot, "build-tools/tools/dev/zx-init.mjs"),
      stdio: "pipe",
    });
    return await parseJson<T>(stdout, `deploy.ts ${source}`);
  } catch (error: any) {
    const stderr = String(error?.stderr || "").trim();
    throw new JenkinsDeployError(
      source === "plan" ? "remote_plan_failed" : "remote_deploy_failed",
      stderr || String(error?.message || error),
      stderr || undefined,
    );
  }
}

function childArgs(ctx: JenkinsContext): string[] {
  return [
    "--deployment",
    ctx.deploymentLabel,
    ...(hasFlag("admission-evidence-json")
      ? ["--admission-evidence-json", requireFlagValue("admission-evidence-json")]
      : []),
    ...(hasFlag("mark-check-passed")
      ? ["--mark-check-passed", requireFlagValue("mark-check-passed")]
      : []),
    "--profile",
    ctx.profileName,
    "--artifact-dir",
    ctx.artifactDir,
    ...(hasFlag("profile-root") ? ["--profile-root", requireFlagValue("profile-root")] : []),
    ...(getFlagBool("retain-remote-artifact") ? ["--retain-remote-artifact"] : []),
    ...smokeOverrideArgs(),
  ];
}

async function main() {
  let ctx: JenkinsContext | undefined;
  let plan: NixosSharedHostRemotePlan | undefined;
  try {
    requireNoUnsupportedFlags();
    assertNoHostApplyFlags();
    ctx = {
      deploymentLabel: requireFlagValue("deployment"),
      profileName: requireFlagValue("profile"),
      artifactDir: await requireExistingPath("artifact-dir", "directory"),
      planOnly: getFlagBool("plan"),
      requestedHostApplyMode: "skip",
      sshIdentityFile: await requireExistingPath("ssh-identity-file", "file"),
      sshKnownHostsFile: await requireExistingPath("ssh-known-hosts", "file"),
      repoRoot: await findRepoRoot(process.cwd()),
    };
    const args = childArgs(ctx);
    plan = await runDeployChild<NixosSharedHostRemotePlan>(ctx, [...args, "--plan"], "plan");
    if (ctx.planOnly) {
      console.log(
        JSON.stringify(
          { ok: true, ...createJenkinsEnvelope(ctx, plan), remotePlan: plan },
          null,
          2,
        ),
      );
      return;
    }
    const remoteExecution = await runDeployChild<NixosSharedHostRemoteDeploySummary>(
      ctx,
      args,
      "deploy",
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...createJenkinsEnvelope(ctx, plan),
          remotePlan: plan,
          remoteExecution,
        },
        null,
        2,
      ),
    );
  } catch (error: any) {
    const failure =
      error instanceof JenkinsDeployError
        ? error
        : new JenkinsDeployError("unexpected_error", String(error?.message || error));
    console.log(
      JSON.stringify(
        {
          ok: false,
          ...(ctx
            ? createJenkinsEnvelope(ctx, plan)
            : {
                schemaVersion: JENKINS_DEPLOY_SCHEMA_VERSION,
                planOnly: getFlagBool("plan"),
              }),
          error: {
            code: failure.code,
            message: failure.message,
            ...(failure.stderr ? { stderr: failure.stderr } : {}),
          },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

main();
