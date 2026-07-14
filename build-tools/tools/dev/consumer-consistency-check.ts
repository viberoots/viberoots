#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findRepoRoot } from "../lib/repo";
import { inferBootstrapConsumerModeSync } from "../lib/consumer-source-mode";
import { buckconfig } from "../lib/consumer-bootstrap";
import { envrc } from "../lib/consumer-direnv";
import {
  guardedConsumerTrackedPaths,
  staleConsumerTrackedInput,
  type GuardedConsumerTrackedPath,
} from "../lib/consumer-tracked-inputs";
import { discoverImportersWithLock } from "./install/importers";
import { buildToolPath, zxInitPath } from "./dev-build/paths";
import { envWithResolvedNixBin } from "../lib/tool-paths";

const execFileAsync = promisify(execFile);

async function gitOutput(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer: 1024 * 1024 * 16,
  });
  return String(stdout || "").trim();
}

async function trackedChanges(repoRoot: string): Promise<string[]> {
  const [worktree, index] = await Promise.all([
    gitOutput(repoRoot, ["diff", "--name-only", "--"]).catch(() => ""),
    gitOutput(repoRoot, ["diff", "--cached", "--name-only", "--"]).catch(() => ""),
  ]);
  return Array.from(
    new Set([...worktree.split(/\r?\n/), ...index.split(/\r?\n/)].filter(Boolean)),
  ).sort();
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function readRootLockRev(repoRoot: string): Promise<string> {
  try {
    const lock = JSON.parse(await fsp.readFile(path.join(repoRoot, "flake.lock"), "utf8")) as {
      nodes?: { viberoots?: { locked?: { rev?: string } } };
    };
    return String(lock.nodes?.viberoots?.locked?.rev || "").trim();
  } catch {
    return "";
  }
}

async function gitlinkRev(repoRoot: string): Promise<string> {
  const out = await gitOutput(repoRoot, ["ls-files", "-s", "viberoots"]).catch(() => "");
  for (const line of out.split(/\r?\n/)) {
    const [mode, rev] = line.trim().split(/\s+/);
    if (mode === "160000" && /^[0-9a-f]{40}$/i.test(rev || "")) return rev;
  }
  return "";
}

async function submoduleHead(repoRoot: string): Promise<string> {
  return await gitOutput(repoRoot, ["-C", "viberoots", "rev-parse", "HEAD"]).catch(() => "");
}

function fail(message: string, repair: string): never {
  throw new Error(`error: ${message}\n\nrepair: run ${repair}`);
}

async function runReadOnlyPnpmChecks(repoRoot: string): Promise<void> {
  const importers = await discoverImportersWithLock(repoRoot, { cwd: repoRoot });
  const update = buildToolPath(repoRoot, "tools/dev/update-pnpm-hash.ts");
  const env = envWithResolvedNixBin({
    ...process.env,
    VBR_PNPM_HASHES_READONLY: "1",
    WORKSPACE_ROOT: repoRoot,
    ZX_INIT: zxInitPath(repoRoot),
  });
  for (const importer of importers) {
    const lockfile =
      importer === "viberoots" ? "viberoots/pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
    try {
      await execFileAsync("zx-wrapper", [update, "--lockfile", lockfile, "--read-only"], {
        cwd: repoRoot,
        env,
        maxBuffer: 1024 * 1024 * 16,
      });
    } catch (error) {
      const e = error as { stdout?: unknown; stderr?: unknown };
      const detail = [e.stderr, e.stdout].map((part) => String(part || "").trim()).filter(Boolean);
      fail(
        `tracked pnpm hash metadata is stale for ${lockfile}${detail.length ? `\n\n${detail.join("\n")}` : ""}`,
        "u",
      );
    }
  }
}

async function assertPostCloneGeneratedFilesReady(
  repoRoot: string,
  mode: "flake" | "submodule",
): Promise<void> {
  const trackedContent: Partial<Record<GuardedConsumerTrackedPath, string>> = {};
  for (const rel of guardedConsumerTrackedPaths) {
    const tracked = await gitOutput(repoRoot, ["ls-files", "--error-unmatch", "--", rel])
      .then(() => true)
      .catch(() => false);
    if (!tracked) continue;
    trackedContent[rel] = await fsp.readFile(path.join(repoRoot, rel), "utf8").catch(() => "");
  }
  const stale = staleConsumerTrackedInput({
    tracked: trackedContent,
    expectedBuckconfig: buckconfig(mode),
    expectedEnvrc: envrc(),
  });
  if (stale) {
    fail(`post-clone would refresh stale generated file ${stale}`, "viberoots update");
  }
}

export async function checkConsumerConsistency(
  repoRoot: string,
  opts: { checkPnpm?: (repoRoot: string) => Promise<void> } = {},
): Promise<void> {
  const before = await trackedChanges(repoRoot);
  const mode = inferBootstrapConsumerModeSync(repoRoot);
  const gitlink = await gitlinkRev(repoRoot);
  const submodule = mode === "submodule" || gitlink ? await submoduleHead(repoRoot) : "";
  const prospectiveGitlink = mode === "submodule" && submodule ? submodule : gitlink;
  const lockRev = await readRootLockRev(repoRoot);

  if (mode === "submodule" && !prospectiveGitlink) {
    fail(
      "source mode is submodule but viberoots has no checkout to stage as a gitlink",
      "viberoots update",
    );
  }
  if (mode === "submodule" && prospectiveGitlink && lockRev && prospectiveGitlink !== lockRev) {
    fail(
      `prospective viberoots gitlink ${prospectiveGitlink} does not match flake.lock ${lockRev}`,
      "viberoots update",
    );
  }
  if (mode === "flake" && gitlink) {
    const currentTarget = await fsp
      .readlink(path.join(repoRoot, ".viberoots", "current"))
      .catch(() => "");
    if (currentTarget === "../viberoots") {
      fail(
        "source mode is flake but .viberoots/current points at the submodule",
        "viberoots update",
      );
    }
  }

  await assertPostCloneGeneratedFilesReady(repoRoot, mode);
  await (opts.checkPnpm || runReadOnlyPnpmChecks)(repoRoot);

  const after = await trackedChanges(repoRoot);
  if (!sameList(before, after)) {
    fail(
      `read-only consistency check changed tracked files\nbefore: ${before.join(", ") || "<clean>"}\nafter:  ${after.join(", ") || "<clean>"}`,
      "viberoots update",
    );
  }
  console.log("viberoots consumer consistency check passed");
}

async function main(): Promise<void> {
  await checkConsumerConsistency(await findRepoRoot(process.cwd()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
