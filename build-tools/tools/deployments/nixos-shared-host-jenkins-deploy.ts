#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot } from "../lib/repo";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";
import {
  REMOTE_SSH_IDENTITY_FILE_ENV,
  REMOTE_SSH_KNOWN_HOSTS_FILE_ENV,
} from "./nixos-shared-host-remote-ssh";
import {
  JENKINS_DEPLOY_SCHEMA_VERSION,
  JenkinsDeployError,
  type JenkinsContext,
  createJenkinsEnvelope,
} from "./nixos-shared-host-jenkins-contract";
import {
  jenkinsSmokeOverrideArgs,
  requireJenkinsFlagValue,
} from "./nixos-shared-host-jenkins-flags";
import type { NixosSharedHostRemoteDeploySummary } from "./nixos-shared-host-remote-execution";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target";

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

function requireNoUnsupportedFlags() {
  const hit = UNSUPPORTED_FLAGS.filter((flag) => hasFlag(flag));
  if (hit.length > 0)
    throw new JenkinsDeployError(
      "unsupported_flag",
      `unsupported Jenkins wrapper flags: ${hit.map((flag) => `--${flag}`).join(", ")}`,
    );
}

function assertNoHostApplyFlags() {
  const applyHost = getFlagBool("apply-host");
  const dryRun = getFlagBool("apply-host-dry-run");
  if (applyHost && dryRun)
    throw new JenkinsDeployError(
      "incompatible_flags",
      "--apply-host and --apply-host-dry-run cannot be combined",
    );
  if (applyHost || dryRun)
    throw new JenkinsDeployError(
      "unsupported_flag",
      "service-only Jenkins wrapper does not support --apply-host or --apply-host-dry-run",
    );
}

async function requireExistingPath(flagName: string, kind: "file" | "directory"): Promise<string> {
  const abs = path.resolve(requireJenkinsFlagValue(flagName));
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
      ? ["--admission-evidence-json", requireJenkinsFlagValue("admission-evidence-json")]
      : []),
    ...(hasFlag("idempotency-key")
      ? ["--idempotency-key", requireJenkinsFlagValue("idempotency-key")]
      : []),
    ...(hasFlag("auth-session-id")
      ? ["--auth-session-id", requireJenkinsFlagValue("auth-session-id")]
      : []),
    ...(hasFlag("admit-and-deploy")
      ? ((value) => (value ? ["--admit-and-deploy", value] : ["--admit-and-deploy"]))(
          getFlagStr("admit-and-deploy", "").trim(),
        )
      : []),
    ...(hasFlag("admit-for-commit")
      ? ["--admit-for-commit", requireJenkinsFlagValue("admit-for-commit")]
      : []),
    "--profile",
    ctx.profileName,
    "--artifact-dir",
    ctx.artifactDir,
    ...(hasFlag("profile-root") ? ["--profile-root", requireJenkinsFlagValue("profile-root")] : []),
    ...(getFlagBool("retain-remote-artifact") ? ["--retain-remote-artifact"] : []),
    ...jenkinsSmokeOverrideArgs(),
  ];
}

async function main() {
  let ctx: JenkinsContext | undefined;
  let plan: NixosSharedHostRemotePlan | undefined;
  try {
    requireNoUnsupportedFlags();
    assertNoHostApplyFlags();
    ctx = {
      deploymentLabel: requireJenkinsFlagValue("deployment"),
      profileName: requireJenkinsFlagValue("profile"),
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
