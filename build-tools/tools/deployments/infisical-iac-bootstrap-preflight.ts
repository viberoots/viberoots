import * as path from "node:path";
import * as readline from "node:readline/promises";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  withDeploymentBootstrapDefaults,
} from "./infisical-iac-bootstrap-config";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

type PreflightIo = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  question?: (prompt: string) => Promise<string>;
};

export async function confirmBootstrapPreflight(args: BootstrapArgs, io: PreflightIo = {}) {
  if (args.dryRun || args.yes) return;
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(nonInteractiveConfirmationError(args));
  }
  const answer = await askConfirmation(
    [
      "Infisical bootstrap can create or update resolver config and credential sink output.",
      "Continue? [Y/n] ",
    ].join("\n"),
    io,
  );
  if (!isAffirmativeConfirmation(answer)) {
    throw new Error(`Infisical bootstrap cancelled; ${unchangedStateMessage(args)}`);
  }
}

export function isAffirmativeConfirmation(answer: string) {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "y" || normalized === "yes";
}

export function assertBootstrapPreflight(args: BootstrapArgs) {
  if (args.dryRun || args.yes) return;
  throw new Error(nonInteractiveConfirmationError(args));
}

function nonInteractiveConfirmationError(args: BootstrapArgs) {
  return [
    "Infisical bootstrap needs confirmation before mutation-capable execution.",
    unchangedStateMessage(args),
    `Retry non-interactively: ${bootstrapRetryCommand(args)}`,
    "Or rerun from an interactive terminal and confirm the prompt.",
    "Use --dry-run for read-only inspection.",
  ].join("\n");
}

function unchangedStateMessage(args: BootstrapArgs) {
  if (args.mode === "deployment") {
    return "No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.";
  }
  return "No Infisical resources, resolver config, or credential sink output was changed.";
}

export async function askConfirmation(prompt: string, io: PreflightIo) {
  if (io.question) return await io.question(prompt);
  const rl = readline.createInterface({
    input: io.stdin || process.stdin,
    output: io.stdout || process.stdout,
  });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export function bootstrapRetryCommand(args: BootstrapArgs) {
  const retryArgs = withDeploymentBootstrapDefaults(args);
  return [
    "build-tools/tools/deployments/infisical-bootstrap.ts",
    retryArgs.mode,
    ...(retryArgs.mode === "deployment" ? retryFlag("target", retryArgs.target) : []),
    ...retryFlag("infisical-host", retryArgs.hostOverride ? retryArgs.apiUrl : ""),
    ...retryFlag("organization-id", retryArgs.organizationId),
    ...retryFlag("org-name", retryArgs.orgName),
    ...(retryArgs.mode === "deployment" ? retryFlag("tofu-dir", retryArgs.tofuDir) : []),
    ...(retryArgs.mode === "deployment" ? retryFlag("tofu-plan-file", retryArgs.tofuPlanFile) : []),
    ...retryFlag(
      "credential-sink",
      retryArgs.credentialSink === "auto" ? "" : retryArgs.credentialSink,
    ),
    ...retryFlag(
      "local-credential-file",
      retryArgs.localCredentialFile === DEFAULT_BOOTSTRAP_ARGS.localCredentialFile
        ? ""
        : retryArgs.localCredentialFile,
    ),
    ...retryFlag("machine-label", retryArgs.machineLabel),
    ...retryBoolFlag("rotate-bootstrap-credentials", retryArgs.rotateBootstrapCredentials),
    ...retryBoolFlag("rotate-deployment-credentials", retryArgs.rotateDeploymentCredentials),
    ...retryBoolFlag("force-overwrite-local-credentials", retryArgs.forceOverwriteLocalCredentials),
    "--yes",
  ].join(" ");
}

function retryFlag(name: string, value?: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  return [`--${name}`, quoteShell(trimmed)];
}

function retryBoolFlag(name: string, enabled: boolean) {
  return enabled ? [`--${name}`] : [];
}

function quoteShell(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolverConfigPath(dir = "sprinkleref") {
  return path.join(dir, "selected.local.json");
}
