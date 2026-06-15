#!/usr/bin/env zx-wrapper
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli";
import { findExtractionBlockers } from "../lib/extraction-blockers";
import { resolveWorkspaceRootsSync } from "../lib/repo";
import { activateWorkspace } from "../lib/workspace-activation";

type VersionStatus = ReturnType<typeof buildVersionStatus>;

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function checkedOutRevision(root: string): string {
  return git(["rev-parse", "HEAD"], root) || "unknown";
}

function lockedRevision(workspaceRoot: string): string {
  try {
    const lockPath = path.join(workspaceRoot, "flake.lock");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const nodes = lock?.nodes || {};
    const node = nodes.viberoots || nodes.viberootsInput;
    return String(node?.locked?.rev || "").trim();
  } catch {
    return "";
  }
}

function revision(root: string, sourceMode: string, workspaceRoot: string) {
  const checkedOut = checkedOutRevision(root);
  if (checkedOut !== "unknown") return { value: checkedOut, source: "git" };
  if (sourceMode === "remote") {
    const locked = lockedRevision(workspaceRoot);
    if (locked) return { value: locked, source: "flake-lock" };
  }
  return { value: "unknown", source: "unknown" };
}

function dirtyState(root: string, sourceMode: string): string {
  if (sourceMode !== "local") return "not-applicable";
  const status = git(["status", "--porcelain=v1"], root);
  if (!status && checkedOutRevision(root) === "unknown") return "unknown";
  return status ? "dirty" : "clean";
}

function gitlinkRevision(workspaceRoot: string): string {
  const entry = git(["ls-files", "-s", "viberoots"], workspaceRoot);
  return entry.match(/^160000\s+([0-9a-f]{40})\s+/)?.[1] || "";
}

function submoduleState(workspaceRoot: string, viberootsRoot: string): string {
  const expected = gitlinkRevision(workspaceRoot);
  if (!expected) return "not-gitlink";
  const actual = checkedOutRevision(viberootsRoot);
  if (actual === "unknown") return "uninitialized";
  if (actual !== expected) return "gitlink-mismatch";
  return dirtyState(viberootsRoot, "local") === "dirty" ? "dirty" : "clean";
}

function currentDisplay(status: VersionStatus): string {
  if (status.currentStatus === "missing") return `${status.viberootsCurrent} (missing)`;
  if (status.viberootsCurrent === status.viberootsRoot) return status.viberootsCurrent;
  return `${status.viberootsCurrent} -> ${status.viberootsRoot}`;
}

function buildVersionStatus() {
  const roots = resolveWorkspaceRootsSync();
  const resolvedRevision = revision(roots.viberootsRoot, roots.sourceMode, roots.workspaceRoot);
  const expectedRevision = gitlinkRevision(roots.workspaceRoot);
  return {
    sourceMode: roots.sourceMode,
    declaredVersion: process.env.VIBEROOTS_VERSION || "unknown",
    releaseTag: process.env.VIBEROOTS_RELEASE_TAG || "unknown",
    workspaceRoot: roots.workspaceRoot,
    viberootsRoot: roots.viberootsRoot,
    viberootsCurrent: roots.viberootsCurrent,
    viberootsWorkspace: roots.viberootsWorkspace,
    currentStatus: roots.currentStatus,
    revision: resolvedRevision.value,
    revisionSource: resolvedRevision.source,
    expectedGitlinkRevision: expectedRevision || "unknown",
    submoduleState:
      roots.sourceMode === "local"
        ? submoduleState(roots.workspaceRoot, roots.viberootsRoot)
        : "not-applicable",
    dirtyState: dirtyState(roots.viberootsRoot, roots.sourceMode),
    currentPointsToLiveCheckout: roots.currentPointsToLiveCheckout,
    extractionBlockers: findExtractionBlockers(roots.workspaceRoot),
  };
}

function printText(status: VersionStatus): void {
  console.log(`source mode:    ${status.sourceMode}`);
  console.log(`workspace root: ${status.workspaceRoot}`);
  console.log(`viberoots root: ${status.viberootsRoot}`);
  console.log(`viberoots path: ${currentDisplay(status)}`);
  console.log(`workspace data: ${path.relative(status.workspaceRoot, status.viberootsWorkspace)}`);
  console.log(`version:        ${status.declaredVersion}`);
  console.log(`revision:       ${status.revision}`);
  console.log(`revision source: ${status.revisionSource}`);
  console.log(`gitlink:        ${status.expectedGitlinkRevision}`);
  console.log(`submodule:      ${status.submoduleState}`);
  console.log(`dirty state:    ${status.dirtyState}`);
  console.log(
    `local current:  ${status.currentPointsToLiveCheckout ? "live checkout" : "not live checkout"}`,
  );
  if (status.extractionBlockers.length > 0) {
    console.log("extraction blockers:");
    for (const blocker of status.extractionBlockers) {
      console.log(`  - ${blocker.kind}: ${blocker.path} - ${blocker.detail}`);
    }
  }
}

async function initWorkspace(): Promise<void> {
  const result = await activateWorkspace({
    sourcePath: getFlagStr("source"),
    shellEntry: getFlagBool("shell-entry"),
  });
  if (getFlagBool("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`workspace root: ${result.workspaceRoot}`);
  console.log(`viberoots source: ${result.sourcePath}`);
  console.log(`current link: ${result.currentPath} -> ${result.currentTarget}`);
  console.log(
    `workspace data: ${path.relative(result.workspaceRoot, result.workspaceDirs[0] || "")}`,
  );
}

function usage(): never {
  console.error("usage: viberoots <version|status|init-workspace> [--json] [--source <path>]");
  process.exit(2);
}

async function main() {
  const [command = "version"] = getPositionals();
  if (command === "init-workspace") {
    await initWorkspace();
    return;
  }
  if (command !== "version" && command !== "status") usage();
  const status = buildVersionStatus();
  if (getFlagBool("json")) console.log(JSON.stringify(status, null, 2));
  else printText(status);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
