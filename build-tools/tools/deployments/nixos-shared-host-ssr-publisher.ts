#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";
import type { NixosSharedHostSsrRuntimeContract } from "./contract.ts";
import type { NixosSharedHostContainer } from "./nixos-shared-host.ts";

export type NixosSharedHostSsrPublishResult = {
  artifactIdentity: string;
  releasePath: string;
  activatedPath: string;
  serverEntry: string;
  clientDir: string;
};

export type NixosSharedHostSsrLivePublishState = NixosSharedHostSsrPublishResult;

async function ensureMaterializedTarget(containerRoot: string, layout: NixosSharedHostContainer) {
  for (const rel of [layout.releaseRoot, layout.publishRoot, layout.activeReleaseLink]) {
    const abs = path.join(containerRoot, rel.replace(/^\//, ""));
    try {
      await fsp.lstat(abs);
    } catch {
      throw new Error(`publish target is missing required runtime path: ${abs}`);
    }
  }
}

async function activateRelease(currentLink: string, releasePath: string): Promise<void> {
  const nextLink = `${currentLink}.next`;
  await fsp.rm(nextLink, { recursive: true, force: true });
  await fsp.symlink(releasePath, nextLink);
  await fsp.rename(nextLink, currentLink);
}

async function ensureSsrContract(
  releasePath: string,
  runtimeContract: NixosSharedHostSsrRuntimeContract,
): Promise<{ serverEntry: string; clientDir: string }> {
  const serverEntry = path.join(releasePath, runtimeContract.serverEntry);
  const clientDir = path.join(releasePath, runtimeContract.clientDir);
  const serverStat = await fsp.stat(serverEntry).catch(() => null);
  if (!serverStat?.isFile()) throw new Error(`missing SSR server entry: ${serverEntry}`);
  const clientStat = await fsp.stat(clientDir).catch(() => null);
  if (!clientStat?.isDirectory()) throw new Error(`missing SSR client dir: ${clientDir}`);
  return { serverEntry, clientDir };
}

export async function publishNixosSharedHostSsrWebapp(opts: {
  artifactDir: string;
  artifactIdentity: string;
  containerRoot: string;
  layout: NixosSharedHostContainer;
  runtimeContract: NixosSharedHostSsrRuntimeContract;
}): Promise<NixosSharedHostSsrPublishResult> {
  await ensureMaterializedTarget(opts.containerRoot, opts.layout);
  const releaseRoot = path.join(opts.containerRoot, opts.layout.releaseRoot.replace(/^\//, ""));
  const releasePath = path.join(releaseRoot, opts.artifactIdentity.replace(":", "__"));
  const stagePath = `${releasePath}.stage-${process.pid}-${Date.now()}`;
  await copyTree(path.resolve(opts.artifactDir), stagePath, { cloneMode: "try", force: true });
  await ensureSsrContract(stagePath, opts.runtimeContract);
  await fsp.rm(releasePath, { recursive: true, force: true });
  await fsp.rename(stagePath, releasePath);
  const currentLink = path.join(opts.containerRoot, opts.layout.publishRoot.replace(/^\//, ""));
  await activateRelease(currentLink, releasePath);
  const contractPaths = await ensureSsrContract(releasePath, opts.runtimeContract);
  return {
    artifactIdentity: opts.artifactIdentity,
    releasePath,
    activatedPath: currentLink,
    serverEntry: contractPaths.serverEntry,
    clientDir: contractPaths.clientDir,
  };
}

export async function resolveNixosSharedHostSsrWebappLiveState(opts: {
  containerRoot: string;
  layout: NixosSharedHostContainer;
  runtimeContract: NixosSharedHostSsrRuntimeContract;
  artifactIdentity: string;
}): Promise<NixosSharedHostSsrLivePublishState | undefined> {
  try {
    await ensureMaterializedTarget(opts.containerRoot, opts.layout);
  } catch {
    return undefined;
  }
  const currentLink = path.join(opts.containerRoot, opts.layout.publishRoot.replace(/^\//, ""));
  let releasePath: string;
  try {
    releasePath = await fsp.realpath(currentLink);
  } catch {
    return undefined;
  }
  if (path.basename(releasePath) === ".empty") return undefined;
  const contractPaths = await ensureSsrContract(releasePath, opts.runtimeContract).catch(
    () => null,
  );
  if (!contractPaths) return undefined;
  if (!releasePath.endsWith(opts.artifactIdentity.replace(":", "__"))) return undefined;
  return {
    artifactIdentity: opts.artifactIdentity,
    releasePath,
    activatedPath: currentLink,
    serverEntry: contractPaths.serverEntry,
    clientDir: contractPaths.clientDir,
  };
}
