#!/usr/bin/env zx-wrapper
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { askConfirmation } from "./infisical-iac-bootstrap-preflight";
import { getArgvTokens } from "../lib/argv";
import { findRepoRoot } from "../lib/repo";
import {
  applyLocalResetPlan,
  discoverLocalResetPlan,
  type LocalBootstrapResetPlan,
  type ResetIo,
} from "./infisical-bootstrap-reset-local-state";

export type {
  KeychainResetItem,
  LocalBootstrapResetPlan,
  LocalResetItem,
} from "./infisical-bootstrap-reset-local-state";

type ResetArgs = {
  dryRun: boolean;
  yes: boolean;
};

export function resetLocalUsage(
  command = "build-tools/tools/deployments/infisical-bootstrap-reset-local.ts",
) {
  return `Usage:
  ${command} --dry-run
  ${command}
  ${command} --yes

Options:
  --dry-run  Print the local files and Keychain entries that would be removed
  --yes      Skip the interactive RESET confirmation
`;
}

export async function runInfisicalBootstrapResetLocal(argv = getArgvTokens(), io: ResetIo = {}) {
  const stdout = io.stdout || console.log;
  const stderr = io.stderr || console.error;
  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(resetLocalUsage());
    return { localItems: [], keychainService: "", keychainItems: [] };
  }
  const args = parseArgs(argv);
  const root = await resolveResetRoot(io);
  const plan = await discoverLocalResetPlan(io, root);
  printResetPlan(stdout, args, plan);
  if (!hasResetPlanItems(plan)) return plan;
  if (!args.dryRun && !args.yes) {
    if (!io.question && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      throw new Error("local Infisical bootstrap reset requires an interactive terminal or --yes");
    }
    const answer = await askConfirmation("Type RESET to delete this local state: ", {
      question: io.question,
    });
    if (answer.trim() !== "RESET") {
      throw new Error(
        "local Infisical bootstrap reset cancelled; no files or Keychain entries changed",
      );
    }
  }
  if (args.dryRun) return plan;
  await applyLocalResetPlan(io, stderr, root, plan);
  stdout("Local Infisical bootstrap state reset complete.");
  return plan;
}

function parseArgs(argv: string[]): ResetArgs {
  const allowed = new Set(["--dry-run", "--yes"]);
  for (const item of argv) {
    if (!allowed.has(item)) throw new Error(`unknown argument ${item}`);
  }
  return { dryRun: argv.includes("--dry-run"), yes: argv.includes("--yes") };
}

export function hasResetPlanItems(plan: LocalBootstrapResetPlan | void) {
  return Boolean(plan && (plan.localItems.length > 0 || plan.keychainItems.length > 0));
}

function printResetPlan(
  stdout: (text: string) => void,
  args: ResetArgs,
  plan: LocalBootstrapResetPlan,
) {
  const modeLine = args.dryRun
    ? "Mode: DRY RUN (no files or Keychain entries will be deleted)"
    : "Mode: RESET (listed files and Keychain entries will be deleted)";
  const fileHeading = args.dryRun
    ? "Existing local files/directories that would be deleted:"
    : "Existing local files/directories that will be deleted:";
  const keychainHeading = args.dryRun
    ? `Existing macOS Keychain entries that would be deleted from service ${plan.keychainService}:`
    : `Existing macOS Keychain entries that will be deleted from service ${plan.keychainService}:`;
  const lines = ["Infisical bootstrap local reset", modeLine, ""];
  if (!hasResetPlanItems(plan)) {
    lines.push("No existing local bootstrap files or Keychain entries were found.", "");
  }
  if (plan.localItems.length > 0) {
    lines.push(
      fileHeading,
      ...plan.localItems.map((item) => `  - ${item.path} - ${item.description}`),
      "",
    );
  }
  if (plan.keychainItems.length > 0) {
    lines.push(
      keychainHeading,
      ...plan.keychainItems.map((item) => `  - ${item.account} - ${item.description}`),
      "",
    );
  }
  lines.push(
    "Infisical cloud resources, Cloudflare secrets, and application secrets are not deleted.",
    "Back up any listed local credential values you still need before running the real reset.",
  );
  stdout(
    lines
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n")
      .trimEnd(),
  );
}

async function resolveResetRoot(io: ResetIo) {
  if (io.cwd) return path.resolve(io.cwd);
  return await findRepoRoot(path.resolve(io.cwd || process.cwd()));
}

if (isMainModule()) {
  await runInfisicalBootstrapResetLocal().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
