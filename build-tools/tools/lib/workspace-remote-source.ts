#!/usr/bin/env zx-wrapper
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type FlakeInputNode = {
  locked?: Record<string, unknown>;
  original?: Record<string, unknown>;
};

export type RemoteSourceStatus = {
  requestedRef: string;
  lockedRevision: string;
  sourcePath: string;
};

function workspaceFlakeRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".viberoots", "workspace");
}

function readViberootsNode(workspaceRoot: string): FlakeInputNode | null {
  try {
    const lock = JSON.parse(
      fs.readFileSync(path.join(workspaceFlakeRoot(workspaceRoot), "flake.lock"), "utf8"),
    );
    const nodes = lock?.nodes || {};
    return nodes.viberoots || nodes.viberootsInput || null;
  } catch {
    return null;
  }
}

function refFromNodePart(part: Record<string, unknown> | undefined): string {
  if (!part) return "";
  if (part.type === "github") {
    const owner = String(part.owner || "").trim();
    const repo = String(part.repo || "").trim();
    const ref = String(part.ref || part.rev || "").trim();
    if (owner && repo && ref) return `github:${owner}/${repo}/${ref}`;
    if (owner && repo) return `github:${owner}/${repo}`;
  }
  if (part.type === "git" && part.url) {
    const ref = String(part.ref || part.rev || "").trim();
    return ref ? `${part.url}?ref=${ref}` : String(part.url);
  }
  if (part.path) return String(part.path);
  return "";
}

export function remoteSourceStatus(workspaceRoot: string): RemoteSourceStatus | null {
  const flakeRoot = workspaceFlakeRoot(workspaceRoot);
  if (!fs.existsSync(path.join(flakeRoot, "flake.nix"))) return null;
  const node = readViberootsNode(workspaceRoot);
  const locked = node?.locked || {};
  const requestedRef = refFromNodePart(node?.original) || refFromNodePart(locked);
  const lockedRevision = String(locked.rev || locked.narHash || "").trim();
  const sourcePath = execFileSync(
    "nix",
    ["eval", "--raw", "--accept-flake-config", `path:${flakeRoot}#lib.viberootsSourcePath`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  return { requestedRef, lockedRevision, sourcePath };
}

export function remoteSourcePath(workspaceRoot: string): string {
  return remoteSourceStatus(workspaceRoot)?.sourcePath || "";
}
