#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";
import { artifactIdentityForStaticWebappDir } from "./nixos-shared-host-artifacts.ts";

type PublishRootLayout = {
  releaseRoot: string;
  publishRoot: string;
  activeReleaseLink: string;
};

export type NixosSharedHostStaticPublishResult = {
  artifactIdentity: string;
  releasePath: string;
  activatedPath: string;
  indexPath: string;
};

async function ensureMaterializedTarget(containerRoot: string, layout: PublishRootLayout) {
  const releaseRoot = path.join(containerRoot, layout.releaseRoot.replace(/^\//, ""));
  const publishRoot = path.join(containerRoot, layout.publishRoot.replace(/^\//, ""));
  const activeRelease = path.join(containerRoot, layout.activeReleaseLink.replace(/^\//, ""));
  for (const required of [releaseRoot, publishRoot, activeRelease]) {
    try {
      await fsp.lstat(required);
    } catch {
      throw new Error(`publish target is missing required runtime path: ${required}`);
    }
  }
}

async function activateRelease(currentLink: string, releasePath: string): Promise<void> {
  const nextLink = `${currentLink}.next`;
  await fsp.rm(nextLink, { recursive: true, force: true });
  await fsp.symlink(releasePath, nextLink);
  await fsp.rename(nextLink, currentLink);
}

export async function publishNixosSharedHostStaticWebapp(opts: {
  artifactDir: string;
  artifactIdentity?: string;
  containerRoot: string;
  layout: PublishRootLayout;
}): Promise<NixosSharedHostStaticPublishResult> {
  const artifactDir = path.resolve(opts.artifactDir);
  const containerRoot = path.resolve(opts.containerRoot);
  await ensureMaterializedTarget(containerRoot, opts.layout);
  const artifactIdentity =
    opts.artifactIdentity || (await artifactIdentityForStaticWebappDir(artifactDir));
  const releaseRoot = path.join(containerRoot, opts.layout.releaseRoot.replace(/^\//, ""));
  const releasePath = path.join(releaseRoot, artifactIdentity.replace(":", "__"));
  try {
    await fsp.access(releasePath);
  } catch {
    const stagePath = path.join(releaseRoot, `.stage-${process.pid}-${Date.now()}`);
    await copyTree(artifactDir, stagePath, { cloneMode: "try", force: true });
    await fsp.rename(stagePath, releasePath);
  }
  const currentLink = path.join(containerRoot, opts.layout.publishRoot.replace(/^\//, ""));
  await activateRelease(currentLink, releasePath);
  const indexPath = path.join(releasePath, "index.html");
  await fsp.access(indexPath);
  return {
    artifactIdentity,
    releasePath,
    activatedPath: currentLink,
    indexPath,
  };
}
