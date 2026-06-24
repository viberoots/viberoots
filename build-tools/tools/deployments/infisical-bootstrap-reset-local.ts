#!/usr/bin/env zx-wrapper
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { askConfirmation } from "./infisical-iac-bootstrap-preflight";
import { macosKeychainCommand } from "./sprinkleref-keychain";
import { getArgvTokens } from "../lib/argv";

const KEYCHAIN_SERVICE = "viberoots-bootstrap";

const LOCAL_PATHS = ["sprinkleref", ".local/infisical-bootstrap-credentials.json"];

const KEYCHAIN_ACCOUNTS = [
  "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id",
  "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret",
];

type ResetArgs = {
  dryRun: boolean;
  yes: boolean;
};

type ResetIo = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  question?: (prompt: string) => Promise<string>;
  platform?: NodeJS.Platform;
  cwd?: string;
  removePath?: (absolutePath: string) => Promise<void>;
  keychainRunner?: (command: string, args: string[]) => { status: number };
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
    return;
  }
  const args = parseArgs(argv);
  const localPaths = await discoverLocalPaths(io);
  printWarning(stdout, args, localPaths);
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
  if (args.dryRun) return;
  await removeLocalPaths(io, localPaths);
  removeKeychainEntries(io, stderr);
  stdout("Local Infisical bootstrap state reset complete.");
}

function parseArgs(argv: string[]): ResetArgs {
  const allowed = new Set(["--dry-run", "--yes"]);
  for (const item of argv) {
    if (!allowed.has(item)) throw new Error(`unknown argument ${item}`);
  }
  return { dryRun: argv.includes("--dry-run"), yes: argv.includes("--yes") };
}

function printWarning(stdout: (text: string) => void, args: ResetArgs, localPaths: string[]) {
  stdout(
    [
      "WARNING: this deletes local Infisical bootstrap state.",
      "",
      "It removes generated local files:",
      ...localPaths.map((item) => `  - ${item}`),
      "",
      `It deletes these macOS Keychain entries from service ${KEYCHAIN_SERVICE}:`,
      ...KEYCHAIN_ACCOUNTS.map((item) => `  - ${item}`),
      "",
      "It does not delete Infisical cloud resources, Cloudflare secrets, or application secrets.",
      args.dryRun ? "Dry run only; nothing will be changed." : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

async function discoverLocalPaths(io: ResetIo) {
  const root = path.resolve(io.cwd || process.cwd());
  const discovered = [...LOCAL_PATHS];
  const deploymentsRoot = path.join(root, "projects", "deployments");
  const families = (await fs.readdir(deploymentsRoot).catch(() => [])).sort();
  for (const family of families) {
    const tofuDir = path.join("projects", "deployments", family, "infisical", "opentofu");
    const absoluteTofuDir = path.join(root, tofuDir);
    const entries = new Set(await fs.readdir(absoluteTofuDir).catch(() => []));
    for (const rel of [
      ".terraform",
      ".terraform.lock.hcl",
      "terraform.tfstate",
      "terraform.tfstate.backup",
    ]) {
      if (entries.has(rel)) discovered.push(path.join(tofuDir, rel));
    }
  }
  return [...new Set(discovered)];
}

async function removeLocalPaths(io: ResetIo, localPaths: string[]) {
  const root = path.resolve(io.cwd || process.cwd());
  const removePath =
    io.removePath || ((target: string) => fs.rm(target, { recursive: true, force: true }));
  for (const item of localPaths) {
    const target = path.resolve(root, item);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`refusing to remove ${item}`);
    await removePath(target);
  }
}

function removeKeychainEntries(io: ResetIo, stderr: (text: string) => void) {
  const platform = io.platform || process.platform;
  if (platform !== "darwin") {
    stderr("Skipping macOS Keychain cleanup because this host is not macOS.");
    return;
  }
  const runner = io.keychainRunner || defaultRunner;
  for (const account of KEYCHAIN_ACCOUNTS) {
    runner("security", macosKeychainCommand("remove", KEYCHAIN_SERVICE, account));
  }
}

function defaultRunner(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return { status: result.status ?? 1 };
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
