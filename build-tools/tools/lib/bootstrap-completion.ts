#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

type BootstrapTransaction = {
  schema?: number;
  transactionId?: string;
  status?: string;
  ownerPid?: number;
  mode?: string;
  workspaceRoot?: string;
  workspaceName?: string;
  source?: string;
  to?: {
    ref?: string;
    url?: string;
    rev?: string;
  };
};

export type BootstrapCompletionResult = {
  checked: boolean;
  repaired: boolean;
  skippedReason?: string;
};

const transactionRel = path.join(".viberoots", "bootstrap", "transactions", "current.json");

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readTransaction(file: string): Promise<BootstrapTransaction | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as BootstrapTransaction;
  } catch {
    return null;
  }
}

async function archiveTransaction(workspaceRoot: string, tx: BootstrapTransaction): Promise<void> {
  const txDir = path.join(workspaceRoot, ".viberoots", "bootstrap", "transactions");
  const current = path.join(txDir, "current.json");
  if (!(await exists(current))) return;
  const completed = path.join(txDir, "completed");
  await fsp.mkdir(completed, { recursive: true });
  const id =
    tx.transactionId || `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`;
  await fsp.rename(current, path.join(completed, `${id}.json`));
}

async function requiredBootstrapFilesPresent(workspaceRoot: string): Promise<boolean> {
  const required = [
    ".buckroot",
    ".buckconfig",
    ".envrc",
    path.join(".viberoots", "current"),
    path.join(".viberoots", "workspace", "flake.nix"),
    "projects",
  ];
  for (const rel of required) {
    if (!(await exists(path.join(workspaceRoot, rel)))) return false;
  }
  return true;
}

export async function checkBootstrapCompletion(opts: {
  workspaceRoot: string;
  repair?: boolean;
  verbose?: boolean;
}): Promise<BootstrapCompletionResult> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const transactionFile = path.join(workspaceRoot, transactionRel);
  const tx = await readTransaction(transactionFile);
  if (!tx) {
    if (opts.verbose && !(await requiredBootstrapFilesPresent(workspaceRoot))) {
      console.error(
        "[bootstrap-check] bootstrap files are incomplete; run the latest bootstrap script",
      );
    }
    return { checked: true, repaired: false, skippedReason: "no-incomplete-transaction" };
  }

  if (pidAlive(tx.ownerPid)) {
    if (opts.verbose) {
      console.error(
        `[bootstrap-check] bootstrap transaction still active: owner_pid=${tx.ownerPid}`,
      );
    }
    return { checked: true, repaired: false, skippedReason: "active-transaction" };
  }

  if (!opts.repair) {
    return { checked: true, repaired: false, skippedReason: "repair-disabled" };
  }

  const mode = tx.mode === "submodule" ? "submodule" : "flake";
  const sourcePath = mode === "submodule" ? "viberoots" : undefined;
  const viberootsUrl =
    mode === "submodule"
      ? `path:${sourcePath}`
      : tx.to?.url || tx.source || "github:viberoots/viberoots/main";
  const workspaceName = tx.workspaceName || path.basename(workspaceRoot);

  console.error(
    `[bootstrap-check] repairing incomplete bootstrap transaction ${tx.transactionId || "(unknown)"}`,
  );
  console.error("[bootstrap-check] migrations:");
  console.error("[bootstrap-check]   - no known migration steps necessary");

  const { initConsumer } = await import("./consumer-bootstrap");
  await initConsumer({
    workspaceRoot,
    workspaceName,
    viberootsUrl,
    sourceMode: mode,
    sourcePath,
    lock: false,
    allowDirenv: false,
    setupDirenv: "never",
    runInstall: false,
  });
  await archiveTransaction(workspaceRoot, tx);
  return { checked: true, repaired: true };
}

export function hasBootstrapTransactionSync(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, transactionRel));
}
