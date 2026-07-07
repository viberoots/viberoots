#!/usr/bin/env zx-wrapper
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { askConfirmation } from "./infisical-iac-bootstrap-preflight";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  withBootstrapCredentialScope,
  withBootstrapKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { macosKeychainCommand } from "./sprinkleref-keychain";
import { getArgvTokens } from "../lib/argv";
import { findRepoRoot } from "../lib/repo";

const LOCAL_PATH_CANDIDATES = [
  {
    path: "sprinkleref",
    description: "legacy local SprinkleRef resolver state directory",
  },
  {
    path: ".local/infisical-bootstrap-credentials.json",
    description: "local-file bootstrap credential store for this checkout",
  },
];

type ResetArgs = {
  dryRun: boolean;
  yes: boolean;
};

export type LocalResetItem = {
  path: string;
  description: string;
};

export type KeychainResetItem = {
  account: string;
  description: string;
};

export type LocalBootstrapResetPlan = {
  localItems: LocalResetItem[];
  keychainService: string;
  keychainItems: KeychainResetItem[];
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
    return { localItems: [], keychainService: "", keychainItems: [] };
  }
  const args = parseArgs(argv);
  const root = await resolveResetRoot(io);
  const keychainService = await resolveBootstrapKeychainService(root);
  const plan = {
    localItems: await discoverLocalItems(root),
    keychainService,
    keychainItems: await discoverKeychainItems(io, root, keychainService),
  };
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
  await removeLocalPaths(io, root, plan.localItems);
  removeKeychainEntries(io, stderr, plan.keychainItems, plan.keychainService);
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

async function discoverKeychainItems(
  io: ResetIo,
  root: string,
  keychainService: string,
): Promise<KeychainResetItem[]> {
  const platform = io.platform || process.platform;
  if (platform !== "darwin") return [];
  const scopedArgs = await withBootstrapCredentialScope(DEFAULT_BOOTSTRAP_ARGS, root);
  const refs = repoBootstrapCredentialRefs(
    { name: scopedArgs.identityName },
    scopedArgs.bootstrapCredentialScope,
  );
  const candidates = [
    {
      account: refs.clientIdRef,
      description: "Infisical Universal Auth client id for this checkout's repo bootstrap identity",
    },
    {
      account: refs.clientSecretRef,
      description:
        "Infisical Universal Auth client secret for this machine; Infisical cannot show this secret again after creation",
    },
  ];
  const runner = io.keychainRunner || defaultRunner;
  const discovered: KeychainResetItem[] = [];
  for (const item of candidates) {
    const result = runner("security", macosKeychainCommand("read", keychainService, item.account));
    if (result.status === 0) discovered.push(item);
  }
  return discovered;
}

async function resolveBootstrapKeychainService(root: string) {
  const scopedArgs = await withBootstrapKeychainServiceName(DEFAULT_BOOTSTRAP_ARGS, root);
  return scopedArgs.bootstrapKeychainServiceName || "";
}

async function discoverLocalItems(root: string): Promise<LocalResetItem[]> {
  const discovered: LocalResetItem[] = [];
  for (const item of LOCAL_PATH_CANDIDATES) {
    if (await pathExists(path.join(root, item.path))) discovered.push(item);
  }
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
      if (entries.has(rel)) {
        discovered.push({
          path: path.join(tofuDir, rel),
          description: localTofuStateDescription(family, rel),
        });
      }
    }
  }
  return uniqueLocalItems(discovered);
}

async function removeLocalPaths(io: ResetIo, root: string, localItems: LocalResetItem[]) {
  const removePath =
    io.removePath || ((target: string) => fs.rm(target, { recursive: true, force: true }));
  for (const item of localItems) {
    const target = path.resolve(root, item.path);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error(`refusing to remove ${item.path}`);
    await removePath(target);
  }
}

async function resolveResetRoot(io: ResetIo) {
  if (io.cwd) return path.resolve(io.cwd);
  return await findRepoRoot(path.resolve(io.cwd || process.cwd()));
}

function removeKeychainEntries(
  io: ResetIo,
  stderr: (text: string) => void,
  keychainItems: KeychainResetItem[],
  keychainService: string,
) {
  const platform = io.platform || process.platform;
  if (platform !== "darwin") {
    stderr("Skipping macOS Keychain cleanup because this host is not macOS.");
    return;
  }
  const runner = io.keychainRunner || defaultRunner;
  for (const item of keychainItems) {
    runner("security", macosKeychainCommand("remove", keychainService, item.account));
  }
}

async function pathExists(target: string) {
  return fs
    .lstat(target)
    .then(() => true)
    .catch(() => false);
}

function uniqueLocalItems(items: LocalResetItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function localTofuStateDescription(family: string, rel: string) {
  if (rel === ".terraform") return `OpenTofu working directory for ${family} deployment bootstrap`;
  if (rel === ".terraform.lock.hcl")
    return `OpenTofu provider lock file for ${family} deployment bootstrap`;
  if (rel === "terraform.tfstate") return `local OpenTofu state for ${family} deployment bootstrap`;
  return `backup of local OpenTofu state for ${family} deployment bootstrap`;
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
