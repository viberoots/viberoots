#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";

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

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, abs)));
      continue;
    }
    if (entry.isFile()) files.push(path.relative(root, abs));
  }
  return files;
}

async function artifactIdentityFor(artifactDir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const rel of await walkFiles(artifactDir)) {
    const abs = path.join(artifactDir, rel);
    hash.update(`${rel}\n`);
    hash.update(await fsp.readFile(abs));
    hash.update("\n");
  }
  return `static-webapp:${hash.digest("hex")}`;
}

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
  containerRoot: string;
  layout: PublishRootLayout;
}): Promise<NixosSharedHostStaticPublishResult> {
  const artifactDir = path.resolve(opts.artifactDir);
  const containerRoot = path.resolve(opts.containerRoot);
  await ensureMaterializedTarget(containerRoot, opts.layout);
  const artifactIdentity = await artifactIdentityFor(artifactDir);
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
