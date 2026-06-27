import { execFile, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GcOptions = {
  workspaceRoot: string;
  dryRun?: boolean;
  aggressive?: boolean;
  optimize?: boolean;
  nix?: boolean;
  verbose?: boolean;
  nixDeleteOlderThan?: string;
  keepCurrentProfile?: boolean;
  localOlderThanMs?: number;
  keepCompletedTransactions?: number;
  deps?: GcDeps;
};

export type GcDeps = {
  commandAvailable?: (command: string) => Promise<boolean>;
  runCommand?: (command: string, args: string[]) => Promise<void>;
  now?: () => number;
};

export type PlannedCommand = {
  command: string;
  args: string[];
  reason: string;
};

export type PlannedRemoval = {
  path: string;
  reason: string;
  bytes: number;
};

export type SkippedCleanup = {
  path: string;
  reason: string;
};

export type GcPlan = {
  dryRun: boolean;
  aggressive: boolean;
  optimize: boolean;
  nix: PlannedCommand[];
  local: PlannedRemoval[];
  skipped: SkippedCleanup[];
};

export type GcSummary = {
  plan: GcPlan;
  localRemoved: number;
  localBytesRemoved: number;
  localSkipped: number;
  nixCommandsRun: number;
};

const dayMs = 24 * 60 * 60 * 1000;

const protectedRelPaths = new Set([
  "",
  ".",
  ".git",
  ".local",
  ".buckconfig",
  ".buckroot",
  ".envrc",
  "README.md",
  "projects",
  "projects/config/local.json",
  "viberoots",
]);

async function defaultCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function defaultRunCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - started) / 1000);
      console.error(
        `[gc] still running: ${[command, ...args].join(" ")} elapsed=${elapsedSeconds}s`,
      );
    }, 30_000);
    child.on("error", (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${[command, ...args].join(" ")} failed${signal ? ` with signal ${signal}` : ` with exit ${code}`}`,
        ),
      );
    });
  });
}

function normalizeWorkspaceRoot(root: string): string {
  return path.resolve(root);
}

function relPath(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath) || ".";
}

function isInsideWorkspace(workspaceRoot: string, absPath: string): boolean {
  const rel = path.relative(workspaceRoot, absPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isProtectedPath(workspaceRoot: string, absPath: string): boolean {
  const rel = relPath(workspaceRoot, absPath);
  if (protectedRelPaths.has(rel)) return true;
  return rel.startsWith(".git/") || rel.startsWith(".local/") || rel.startsWith("projects/");
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fsp.lstat(absPath);
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

async function activeWorkEvidence(workspaceRoot: string): Promise<string[]> {
  const evidence: string[] = [];
  const txFile = path.join(
    workspaceRoot,
    ".viberoots",
    "bootstrap",
    "transactions",
    "current.json",
  );
  try {
    const tx = JSON.parse(await fsp.readFile(txFile, "utf8")) as { ownerPid?: number };
    if (pidAlive(tx.ownerPid)) evidence.push(`active bootstrap transaction pid=${tx.ownerPid}`);
  } catch {}
  for (const rel of [
    path.join(".viberoots", "verify.lock"),
    path.join(".viberoots", "workspace", "buck", "verify.lock"),
    path.join("buck-out", "tmp", "shared-isolation-locks"),
  ]) {
    if (await exists(path.join(workspaceRoot, rel))) {
      evidence.push(`active or ambiguous workspace state: ${rel}`);
    }
  }
  return evidence;
}

async function entryOlderThan(absPath: string, now: number, olderThanMs: number): Promise<boolean> {
  const stat = await fsp.lstat(absPath);
  return now - stat.mtimeMs >= olderThanMs;
}

async function pathBytes(absPath: string): Promise<number> {
  let stat: fs.Stats;
  try {
    stat = await fsp.lstat(absPath);
  } catch {
    return 0;
  }
  if (stat.isSymbolicLink()) return stat.size;
  if (!stat.isDirectory()) return stat.size;
  let total = stat.size;
  for (const entry of await fsp.readdir(absPath)) {
    total += await pathBytes(path.join(absPath, entry));
  }
  return total;
}

async function addRemovalCandidate(
  plan: GcPlan,
  workspaceRoot: string,
  absPath: string,
  reason: string,
): Promise<void> {
  const normalized = path.resolve(absPath);
  const rel = relPath(workspaceRoot, normalized);
  if (!isInsideWorkspace(workspaceRoot, normalized)) {
    plan.skipped.push({ path: rel, reason: "outside workspace root" });
    return;
  }
  if (isProtectedPath(workspaceRoot, normalized)) {
    plan.skipped.push({ path: rel, reason: "protected workspace path" });
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.lstat(normalized);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    plan.skipped.push({ path: rel, reason: "symlink cleanup candidate refused" });
    return;
  }
  plan.local.push({ path: rel, reason, bytes: await pathBytes(normalized) });
}

async function addChildrenOlderThan(
  plan: GcPlan,
  workspaceRoot: string,
  relDir: string,
  now: number,
  olderThanMs: number,
  reason: string,
): Promise<void> {
  const dir = path.join(workspaceRoot, relDir);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const absPath = path.join(dir, entry);
    if (await entryOlderThan(absPath, now, olderThanMs)) {
      await addRemovalCandidate(plan, workspaceRoot, absPath, reason);
    }
  }
}

async function planCompletedTransactionPrune(
  plan: GcPlan,
  workspaceRoot: string,
  keep: number,
): Promise<void> {
  const dir = path.join(workspaceRoot, ".viberoots", "bootstrap", "transactions", "completed");
  let entries: { absPath: string; mtimeMs: number }[] = [];
  try {
    entries = await Promise.all(
      (await fsp.readdir(dir)).map(async (entry) => {
        const absPath = path.join(dir, entry);
        const stat = await fsp.lstat(absPath);
        return { absPath, mtimeMs: stat.mtimeMs };
      }),
    );
  } catch {
    return;
  }
  entries = entries
    .filter((entry) => !path.basename(entry.absPath).startsWith("."))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(Math.max(0, keep))) {
    await addRemovalCandidate(
      plan,
      workspaceRoot,
      entry.absPath,
      "prune old completed transaction",
    );
  }
}

async function planCurrentTransaction(plan: GcPlan, workspaceRoot: string): Promise<void> {
  const current = path.join(
    workspaceRoot,
    ".viberoots",
    "bootstrap",
    "transactions",
    "current.json",
  );
  if (await exists(current)) {
    plan.skipped.push({
      path: relPath(workspaceRoot, current),
      reason: "incomplete transaction; run viberoots bootstrap-check --repair-if-needed",
    });
  }
}

async function buildNixPlan(opts: GcOptions, deps: Required<Pick<GcDeps, "commandAvailable">>) {
  const commands: PlannedCommand[] = [];
  const hasCollectGarbage = await deps.commandAvailable("nix-collect-garbage");
  if (opts.nixDeleteOlderThan && !opts.keepCurrentProfile && hasCollectGarbage) {
    commands.push({
      command: "nix-collect-garbage",
      args: ["--delete-older-than", opts.nixDeleteOlderThan],
      reason: "delete old profile generations and garbage collect Nix store",
    });
    if (opts.optimize) {
      const hasNix = await deps.commandAvailable("nix");
      if (hasNix) {
        commands.push({
          command: "nix",
          args: ["store", "optimise"],
          reason: "deduplicate Nix store paths",
        });
      } else {
        const hasNixStore = await deps.commandAvailable("nix-store");
        if (hasNixStore) {
          commands.push({
            command: "nix-store",
            args: ["--optimise"],
            reason: "deduplicate Nix store paths",
          });
        }
      }
    }
    return commands;
  }
  const hasNix = await deps.commandAvailable("nix");
  if (hasNix) {
    if (opts.nixDeleteOlderThan && !opts.keepCurrentProfile) {
      commands.push({
        command: "nix",
        args: ["profile", "wipe-history", "--older-than", opts.nixDeleteOlderThan],
        reason: "prune old generations of the current Nix profile",
      });
    }
    commands.push({ command: "nix", args: ["store", "gc"], reason: "garbage collect Nix store" });
    if (opts.optimize) {
      commands.push({
        command: "nix",
        args: ["store", "optimise"],
        reason: "deduplicate Nix store paths",
      });
    }
    return commands;
  }
  if (hasCollectGarbage) {
    commands.push({
      command: "nix-collect-garbage",
      args: opts.nixDeleteOlderThan ? ["--delete-older-than", opts.nixDeleteOlderThan] : [],
      reason: "garbage collect Nix store",
    });
  }
  if (opts.optimize) {
    const hasNixStore = await deps.commandAvailable("nix-store");
    if (hasNixStore) {
      commands.push({
        command: "nix-store",
        args: ["--optimise"],
        reason: "deduplicate Nix store paths",
      });
    }
  }
  return commands;
}

export async function planViberootsGc(opts: GcOptions): Promise<GcPlan> {
  const workspaceRoot = normalizeWorkspaceRoot(opts.workspaceRoot);
  const deps = opts.deps || {};
  const commandAvailable = deps.commandAvailable || defaultCommandAvailable;
  const now = deps.now?.() ?? Date.now();
  const olderThanMs = opts.localOlderThanMs ?? dayMs;
  const keepCompletedTransactions = opts.keepCompletedTransactions ?? 20;
  const active = await activeWorkEvidence(workspaceRoot);
  if (opts.aggressive && active.length > 0) {
    throw new Error(`error: refusing aggressive gc while viberoots work is active: ${active[0]}`);
  }
  const plan: GcPlan = {
    dryRun: Boolean(opts.dryRun),
    aggressive: Boolean(opts.aggressive),
    optimize: Boolean(opts.optimize),
    nix: opts.nix === false ? [] : await buildNixPlan(opts, { commandAvailable }),
    local: [],
    skipped: [],
  };
  await addChildrenOlderThan(
    plan,
    workspaceRoot,
    path.join(".viberoots", "workspace", "buck", "tmp"),
    now,
    olderThanMs,
    "stale generated workspace Buck temp state",
  );
  await addChildrenOlderThan(
    plan,
    workspaceRoot,
    path.join(".viberoots", "buck", "tmp"),
    now,
    olderThanMs,
    "stale generated viberoots Buck temp state",
  );
  await addChildrenOlderThan(
    plan,
    workspaceRoot,
    path.join("buck-out", "tmp", "shared-isolation-locks"),
    now,
    olderThanMs,
    "stale shared isolation lock state",
  );
  for (const relDir of ["buck-out"]) {
    const dir = path.join(workspaceRoot, relDir);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {}
    for (const entry of entries) {
      if (!/^(v-|verify-|devbuild-)/.test(entry)) continue;
      const absPath = path.join(dir, entry);
      if (await entryOlderThan(absPath, now, olderThanMs)) {
        await addRemovalCandidate(
          plan,
          workspaceRoot,
          absPath,
          "stale viberoots-owned Buck isolation root",
        );
      }
    }
  }
  if (opts.aggressive) {
    await addChildrenOlderThan(
      plan,
      workspaceRoot,
      path.join(".viberoots", "cache"),
      now,
      olderThanMs,
      "stale viberoots cache entry",
    );
  }
  await planCompletedTransactionPrune(plan, workspaceRoot, keepCompletedTransactions);
  await planCurrentTransaction(plan, workspaceRoot);
  return plan;
}

async function removePlannedPath(
  workspaceRoot: string,
  removal: PlannedRemoval,
): Promise<SkippedCleanup | null> {
  const absPath = path.resolve(workspaceRoot, removal.path);
  if (!isInsideWorkspace(workspaceRoot, absPath) || isProtectedPath(workspaceRoot, absPath)) {
    return { path: removal.path, reason: "path safety check failed during execution" };
  }
  try {
    const stat = await fsp.lstat(absPath);
    if (stat.isSymbolicLink()) {
      return { path: removal.path, reason: "symlink cleanup candidate refused during execution" };
    }
  } catch {
    return null;
  }
  await fsp.rm(absPath, { recursive: true, force: true });
  return null;
}

export function printGcPlan(plan: GcPlan, opts: Pick<GcOptions, "verbose"> = {}): void {
  console.log("viberoots gc plan");
  console.log("  nix:");
  if (plan.nix.length === 0) console.log("    - nix cleanup disabled or unavailable");
  for (const command of plan.nix) {
    console.log(`    - ${[command.command, ...command.args].join(" ")} (${command.reason})`);
  }
  console.log("  local generated state:");
  if (plan.local.length === 0) console.log("    - no local generated state cleanup candidates");
  for (const removal of plan.local) {
    console.log(`    - remove ${removal.path} (${removal.reason})`);
  }
  console.log("  skipped:");
  if (plan.skipped.length === 0) console.log("    - none");
  else if (!opts.verbose) {
    const counts = new Map<string, number>();
    for (const skipped of plan.skipped) {
      counts.set(skipped.reason, (counts.get(skipped.reason) ?? 0) + 1);
    }
    for (const [reason, count] of counts) {
      console.log(`    - ${count} skipped (${reason})`);
    }
    console.log("    - pass --verbose to list skipped paths");
  } else {
    for (const skipped of plan.skipped) {
      console.log(`    - ${skipped.path} (${skipped.reason})`);
    }
  }
}

export async function runViberootsGc(opts: GcOptions): Promise<GcSummary> {
  const workspaceRoot = normalizeWorkspaceRoot(opts.workspaceRoot);
  const deps = opts.deps || {};
  const runCommand = deps.runCommand || defaultRunCommand;
  const plan = await planViberootsGc(opts);
  printGcPlan(plan, { verbose: opts.verbose });
  if (opts.dryRun) {
    return {
      plan,
      localRemoved: 0,
      localBytesRemoved: 0,
      localSkipped: plan.skipped.length,
      nixCommandsRun: 0,
    };
  }
  let localRemoved = 0;
  let localBytesRemoved = 0;
  let localSkipped = plan.skipped.length;
  if (plan.local.length > 0) {
    console.error(`[gc] removing local generated state: ${plan.local.length} path(s)`);
  }
  for (const removal of plan.local) {
    const skipped = await removePlannedPath(workspaceRoot, removal);
    if (skipped) {
      localSkipped += 1;
      console.error(`[gc] skipped ${skipped.path}: ${skipped.reason}`);
      continue;
    }
    localRemoved += 1;
    localBytesRemoved += removal.bytes;
    if (localRemoved % 100 === 0 || localRemoved === plan.local.length) {
      console.error(`[gc] removed local generated state: ${localRemoved}/${plan.local.length}`);
    }
  }
  let nixCommandsRun = 0;
  for (const command of plan.nix) {
    if (command.reason.includes("deduplicate")) {
      console.error("nix store optimization is opt-in and may take a while");
    }
    console.error(`[gc] running: ${[command.command, ...command.args].join(" ")}`);
    await runCommand(command.command, command.args);
    nixCommandsRun += 1;
    console.error(`[gc] completed: ${[command.command, ...command.args].join(" ")}`);
  }
  console.log("viberoots gc summary");
  console.log(`  nix cleanup: ${nixCommandsRun > 0 ? "completed" : "skipped"}`);
  console.log(`  local paths removed: ${localRemoved}`);
  console.log(`  bytes removed from local generated state: ${localBytesRemoved}`);
  console.log(`  skipped: ${localSkipped}`);
  return { plan, localRemoved, localBytesRemoved, localSkipped, nixCommandsRun };
}
