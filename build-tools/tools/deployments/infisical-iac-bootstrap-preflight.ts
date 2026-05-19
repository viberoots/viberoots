import * as path from "node:path";
import * as readline from "node:readline/promises";
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
    throw new Error(
      [
        "Infisical bootstrap needs confirmation before mutation-capable execution.",
        "No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.",
        `Retry non-interactively: ${bootstrapRetryCommand(args)}`,
        "Or rerun from an interactive terminal and confirm the prompt.",
        "Use --dry-run for read-only inspection.",
      ].join("\n"),
    );
  }
  const answer = await askConfirmation(
    [
      "Infisical bootstrap can create or update resolver config and credential sink output.",
      "Continue? [Y/n] ",
    ].join("\n"),
    io,
  );
  if (!isAffirmativeConfirmation(answer)) {
    throw new Error(
      "Infisical bootstrap cancelled; no Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.",
    );
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
    "No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.",
    `Retry non-interactively: ${bootstrapRetryCommand(args)}`,
    "Or rerun from an interactive terminal and confirm the prompt.",
    "Use --dry-run for read-only inspection.",
  ].join("\n");
}

async function askConfirmation(prompt: string, io: PreflightIo) {
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
  return [
    "build-tools/tools/deployments/infisical-bootstrap.ts",
    args.mode,
    ...(args.mode === "deployment" ? retryFlag("target", args.target) : []),
    ...retryFlag("infisical-host", args.hostOverride ? args.apiUrl : ""),
    ...retryFlag("organization-id", args.organizationId),
    ...retryFlag("org-name", args.orgName),
    ...retryFlag("tofu-dir", args.tofuDir),
    ...retryFlag("tofu-plan-file", args.tofuPlanFile),
    ...retryFlag("credential-sink", args.credentialSink === "auto" ? "" : args.credentialSink),
    ...retryFlag("local-credential-file", args.localCredentialFile),
    "--yes",
  ].join(" ");
}

function retryFlag(name: string, value?: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  return [`--${name}`, quoteShell(trimmed)];
}

function quoteShell(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolverConfigPath(dir = "sprinkleref") {
  return path.join(dir, "selected.local.json");
}
