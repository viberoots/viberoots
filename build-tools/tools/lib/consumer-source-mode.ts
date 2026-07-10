import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { initConsumer } from "./consumer-bootstrap";

const execFileAsync = promisify(execFile);

export const defaultSubmoduleUrl = "https://github.com/viberoots/viberoots.git";
const officialSubmoduleUrls = new Set([
  defaultSubmoduleUrl,
  "https://github.com/viberoots/viberoots",
  "git@github.com:viberoots/viberoots.git",
]);

type ExecResult = {
  stdout: string;
  stderr: string;
};

export type GitRunner = (args: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

export type SourceModeOperation = "use-submodule" | "use-flake" | "remove-submodule";

type SourceModeTransaction = {
  schema: 1;
  transactionId: string;
  status: "planned" | "completed";
  mode: "flake" | "submodule";
  operation: SourceModeOperation;
  fromMode: string;
  toMode: string;
  workspaceRoot: string;
  workspaceName?: string;
  source?: string;
  currentTarget: string;
  requestedUrl?: string;
  requestedRef?: string;
  to?: {
    ref?: string;
    url?: string;
  };
  submodule?: SubmoduleState;
  ownerPid: number;
  timestamp: string;
};

export type SourceModeOptions = {
  workspaceRoot: string;
  workspaceName?: string;
  git?: GitRunner;
};

export type UseSubmoduleOptions = SourceModeOptions & {
  url?: string;
  trustUrl?: boolean;
  allowDirenv?: boolean;
  runInstall?: boolean;
};

export type UseFlakeOptions = SourceModeOptions & {
  ref?: string;
  removeSubmodule?: boolean;
  allowDirenv?: boolean;
  runInstall?: boolean;
};

export type RemoveSubmoduleOptions = SourceModeOptions & {
  dryRun?: boolean;
};

export type SubmoduleState = {
  exists: boolean;
  isDirectory: boolean;
  gitmodulesPath: boolean;
  gitlink: boolean;
  gitlinkRevision: string;
  url: string;
  worktreeDirty: boolean;
  metadataDirty: boolean;
  metadataStatus: string[];
};

export type RemoveSubmodulePlan = {
  dryRun: boolean;
  state: SubmoduleState;
  commands: string[];
};

async function defaultGit(args: string[], opts?: { cwd?: string }): Promise<ExecResult> {
  return execFileAsync("git", args, {
    cwd: opts?.cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function readlinkIfPresent(p: string): Promise<string> {
  try {
    return await fsp.readlink(p);
  } catch {
    return "";
  }
}

async function gitOutput(git: GitRunner, args: string[], cwd: string): Promise<string> {
  try {
    const result = await git(args, { cwd });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

async function requireGitWorkspace(workspaceRoot: string, git: GitRunner): Promise<void> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], { cwd: workspaceRoot });
  } catch {
    throw new Error("error: source-mode commands require a git workspace");
  }
}

function workspaceName(workspaceRoot: string, explicit: string | undefined): string {
  return explicit || path.basename(workspaceRoot) || "viberoots-consumer";
}

function refToFlakeUrl(ref: string): string {
  return `github:viberoots/viberoots/${ref}`;
}

function officialSubmoduleUrlToFlakeUrl(url: string, ref: string): string {
  if (url === "git@github.com:viberoots/viberoots.git") {
    return `git+ssh://git@github.com/viberoots/viberoots.git?ref=${encodeURIComponent(ref)}`;
  }
  return refToFlakeUrl(ref);
}

function isOfficialSubmoduleUrl(url: string): boolean {
  return officialSubmoduleUrls.has(url);
}

async function submoduleSection(workspaceRoot: string, git: GitRunner): Promise<string> {
  const out = await gitOutput(
    git,
    ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    workspaceRoot,
  );
  for (const line of out.split(/\r?\n/)) {
    const [key, value] = line.trim().split(/\s+/, 2);
    if (key && value === "viberoots") return key.replace(/\.path$/, "");
  }
  return "";
}

export async function detectSubmodule(
  workspaceRoot: string,
  git: GitRunner = defaultGit,
): Promise<SubmoduleState> {
  const submodulePath = path.join(workspaceRoot, "viberoots");
  let stat: fs.Stats | null = null;
  try {
    stat = await fsp.lstat(submodulePath);
  } catch {}
  const section = await submoduleSection(workspaceRoot, git);
  const gitmodulesPath = Boolean(section);
  const url = section
    ? await gitOutput(
        git,
        ["config", "-f", ".gitmodules", "--get", `${section}.url`],
        workspaceRoot,
      )
    : "";
  const gitlinkEntry = await gitOutput(git, ["ls-files", "-s", "viberoots"], workspaceRoot);
  const gitlinkRevision = gitlinkEntry.match(/^160000\s+([0-9a-f]{40})\s+/)?.[1] || "";
  const gitlink = Boolean(gitlinkRevision);
  const worktreeDirty = Boolean(
    stat?.isDirectory() && (await gitOutput(git, ["status", "--porcelain=v1"], submodulePath)),
  );
  const metadataStatus = (
    await gitOutput(
      git,
      ["status", "--porcelain=v1", "--", ".gitmodules", "viberoots"],
      workspaceRoot,
    )
  )
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return {
    exists: Boolean(stat),
    isDirectory: Boolean(stat?.isDirectory()),
    gitmodulesPath,
    gitlink,
    gitlinkRevision,
    url,
    worktreeDirty,
    metadataDirty: metadataStatus.length > 0,
    metadataStatus,
  };
}

export async function currentPointsAtSubmodule(workspaceRoot: string): Promise<boolean> {
  return (
    (await readlinkIfPresent(path.join(workspaceRoot, ".viberoots", "current"))) === "../viberoots"
  );
}

export function inferBootstrapConsumerModeSync(workspaceRoot: string): "flake" | "submodule" {
  try {
    const flake = fs.readFileSync(path.join(workspaceRoot, "flake.nix"), "utf8");
    if (
      /\bviberoots\.url\s*=\s*"path:\.\/\.viberoots\/workspace\/viberoots-flake-input"/.test(flake)
    ) {
      return "submodule";
    }
    if (/\bviberoots\.url\s*=\s*"(?:git\+|github:|https?:)/.test(flake)) {
      return "flake";
    }
  } catch {}

  try {
    if (fs.readlinkSync(path.join(workspaceRoot, ".viberoots", "current")) === "../viberoots") {
      return "submodule";
    }
  } catch {}

  return "flake";
}

function currentModeFromTarget(target: string): string {
  return target === "../viberoots" ? "submodule" : target ? "flake" : "unknown";
}

async function writeTransaction(
  workspaceRoot: string,
  tx: Omit<SourceModeTransaction, "schema" | "transactionId" | "status" | "ownerPid" | "timestamp">,
): Promise<SourceModeTransaction> {
  const source = tx.requestedUrl || (tx.requestedRef ? refToFlakeUrl(tx.requestedRef) : undefined);
  const transaction: SourceModeTransaction = {
    schema: 1,
    transactionId: `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`,
    status: "planned",
    ownerPid: process.pid,
    timestamp: new Date().toISOString(),
    source,
    to: {
      ref: tx.requestedRef,
      url: source,
    },
    ...tx,
  };
  const dir = path.join(workspaceRoot, ".viberoots", "bootstrap", "transactions");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "current.json"),
    `${JSON.stringify(transaction, null, 2)}\n`,
    "utf8",
  );
  return transaction;
}

async function archiveTransaction(workspaceRoot: string, tx: SourceModeTransaction): Promise<void> {
  const dir = path.join(workspaceRoot, ".viberoots", "bootstrap", "transactions");
  const current = path.join(dir, "current.json");
  if (!(await exists(current))) return;
  const completed = path.join(dir, "completed");
  await fsp.mkdir(completed, { recursive: true });
  const done = { ...tx, status: "completed" as const, timestamp: new Date().toISOString() };
  await fsp.writeFile(current, `${JSON.stringify(done, null, 2)}\n`, "utf8");
  await fsp.rename(current, path.join(completed, `${tx.transactionId}.json`));
}

export async function useSubmodule(opts: UseSubmoduleOptions): Promise<void> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const git = opts.git || defaultGit;
  await requireGitWorkspace(workspaceRoot, git);
  const requestedUrl = opts.url || defaultSubmoduleUrl;
  if (!isOfficialSubmoduleUrl(requestedUrl) && !opts.trustUrl) {
    throw new Error("error: refusing non-default submodule URL without --trust-url");
  }
  const state = await detectSubmodule(workspaceRoot, git);
  if (state.url && !isOfficialSubmoduleUrl(state.url) && !opts.trustUrl) {
    throw new Error("error: refusing existing non-default submodule URL without --trust-url");
  }
  if (state.exists && !state.isDirectory) {
    throw new Error(
      "error: viberoots exists and is not a directory; move it before using submodule mode",
    );
  }
  if (state.exists && !state.gitmodulesPath && !state.gitlink) {
    throw new Error(
      "error: viberoots/ exists but is not a submodule; delete or move it, then rerun viberoots use-submodule",
    );
  }

  const currentTarget = await readlinkIfPresent(path.join(workspaceRoot, ".viberoots", "current"));
  const tx = await writeTransaction(workspaceRoot, {
    mode: "submodule",
    operation: "use-submodule",
    fromMode: currentModeFromTarget(currentTarget),
    toMode: "submodule",
    workspaceRoot,
    workspaceName: workspaceName(workspaceRoot, opts.workspaceName),
    currentTarget,
    requestedUrl,
    submodule: state,
  });
  if (state.gitmodulesPath || state.gitlink) {
    await git(["submodule", "update", "--init", "--recursive", "viberoots"], {
      cwd: workspaceRoot,
    });
  } else {
    await git(["submodule", "add", requestedUrl, "viberoots"], { cwd: workspaceRoot });
  }
  await initConsumer({
    workspaceRoot,
    workspaceName: workspaceName(workspaceRoot, opts.workspaceName),
    viberootsUrl: "path:../../viberoots",
    sourceMode: "submodule",
    sourcePath: "viberoots",
    lock: false,
    allowDirenv: opts.allowDirenv !== false,
    setupDirenv: opts.allowDirenv === false ? "never" : "auto",
    runInstall: Boolean(opts.runInstall),
  });
  await archiveTransaction(workspaceRoot, tx);
  console.log("source mode: submodule");
  console.log("next:");
  console.log("direnv reload");
  console.log("i && b && v");
}

export async function useFlake(opts: UseFlakeOptions): Promise<void> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const git = opts.git || defaultGit;
  const ref = opts.ref || process.env.VBR_REF || "main";
  const currentTarget = await readlinkIfPresent(path.join(workspaceRoot, ".viberoots", "current"));
  const state = await detectSubmodule(workspaceRoot, git);
  const flakeUrl = officialSubmoduleUrlToFlakeUrl(state.url, ref);
  const tx = await writeTransaction(workspaceRoot, {
    mode: "flake",
    operation: "use-flake",
    fromMode: currentModeFromTarget(currentTarget),
    toMode: "flake",
    workspaceRoot,
    workspaceName: workspaceName(workspaceRoot, opts.workspaceName),
    currentTarget,
    requestedRef: ref,
    requestedUrl: flakeUrl,
    submodule: state,
  });
  const previousViberootsRoot = process.env.VIBEROOTS_ROOT;
  delete process.env.VIBEROOTS_ROOT;
  try {
    await initConsumer({
      workspaceRoot,
      workspaceName: workspaceName(workspaceRoot, opts.workspaceName),
      viberootsUrl: flakeUrl,
      sourceMode: "flake",
      lock: true,
      allowDirenv: opts.allowDirenv !== false,
      setupDirenv: opts.allowDirenv === false ? "never" : "auto",
      runInstall: Boolean(opts.runInstall),
    });
  } finally {
    if (previousViberootsRoot === undefined) delete process.env.VIBEROOTS_ROOT;
    else process.env.VIBEROOTS_ROOT = previousViberootsRoot;
  }
  await archiveTransaction(workspaceRoot, tx);
  console.log(`source mode: flake (${ref})`);
  if (state.gitmodulesPath || state.gitlink) {
    console.log("inactive viberoots submodule remains:");
    console.log("viberoots remove-submodule");
    console.log("viberoots remove-submodule --dry-run");
  }
  if (opts.removeSubmodule) await removeSubmodule({ workspaceRoot, git });
}

function assertSafeRemove(state: SubmoduleState, active: boolean): void {
  if (active) {
    throw new Error(
      "error: refusing to remove active viberoots submodule; run viberoots use-flake first",
    );
  }
  if (!state.gitmodulesPath && !state.gitlink) {
    if (state.exists) {
      throw new Error(
        "error: viberoots/ is not a submodule; delete the plain checkout manually if you no longer need it",
      );
    }
    throw new Error("error: viberoots submodule is not present");
  }
  if (!state.gitmodulesPath || !state.gitlink) {
    throw new Error(
      "error: unexpected .gitmodules/gitlink state for viberoots; inspect git status first",
    );
  }
  if (state.worktreeDirty) {
    throw new Error(
      "error: refusing to remove dirty viberoots submodule; commit or stash local changes first",
    );
  }
  if (state.metadataDirty) {
    throw new Error(
      `error: refusing to remove submodule with staged or dirty metadata: ${state.metadataStatus.join(", ")}`,
    );
  }
}

export async function planRemoveSubmodule(
  opts: RemoveSubmoduleOptions,
): Promise<RemoveSubmodulePlan> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const git = opts.git || defaultGit;
  await requireGitWorkspace(workspaceRoot, git);
  const state = await detectSubmodule(workspaceRoot, git);
  assertSafeRemove(state, await currentPointsAtSubmodule(workspaceRoot));
  return {
    dryRun: Boolean(opts.dryRun),
    state,
    commands: [
      "git submodule deinit -f viberoots",
      "git rm -f viberoots",
      "rm -rf .git/modules/viberoots",
      "git status --short",
    ],
  };
}

export async function removeSubmodule(opts: RemoveSubmoduleOptions): Promise<void> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const git = opts.git || defaultGit;
  const plan = await planRemoveSubmodule({ ...opts, workspaceRoot, git });
  console.log("viberoots submodule removal plan:");
  for (const command of plan.commands) console.log(`  ${command}`);
  console.log(`submodule url: ${plan.state.url || "unknown"}`);
  if (opts.dryRun) return;

  const currentTarget = await readlinkIfPresent(path.join(workspaceRoot, ".viberoots", "current"));
  const tx = await writeTransaction(workspaceRoot, {
    mode: "flake",
    operation: "remove-submodule",
    fromMode: currentModeFromTarget(currentTarget),
    toMode: "flake",
    workspaceRoot,
    workspaceName: workspaceName(workspaceRoot, opts.workspaceName),
    currentTarget,
    submodule: plan.state,
  });
  await git(["submodule", "deinit", "-f", "viberoots"], { cwd: workspaceRoot });
  await git(["rm", "-f", "viberoots"], { cwd: workspaceRoot });
  await fsp.rm(path.join(workspaceRoot, ".git", "modules", "viberoots"), {
    recursive: true,
    force: true,
  });
  const status = await gitOutput(git, ["status", "--short"], workspaceRoot);
  if (status) console.log(status);
  console.log('git commit -m "remove viberoots submodule"');
  await archiveTransaction(workspaceRoot, tx);
}
