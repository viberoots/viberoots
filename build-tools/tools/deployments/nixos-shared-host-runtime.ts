#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";

function containerRoot(hostRoot: string, containerName: string): string {
  return path.join(hostRoot, "containers", containerName);
}

async function ensureSymlink(linkPath: string, target: string): Promise<void> {
  await fsp.rm(linkPath, { recursive: true, force: true });
  await fsp.symlink(target, linkPath);
}

async function materializeContainerRoot(
  hostRoot: string,
  containerName: string,
  releaseRoot: string,
  activeReleaseLink: string,
  publishRoot: string,
): Promise<void> {
  const root = containerRoot(hostRoot, containerName);
  const releaseRootAbs = path.join(root, releaseRoot.replace(/^\//, ""));
  const emptyReleaseAbs = path.join(releaseRootAbs, ".empty");
  const publishRootAbs = path.join(root, publishRoot.replace(/^\//, ""));
  const activeReleaseAbs = path.join(root, activeReleaseLink.replace(/^\//, ""));
  await fsp.mkdir(emptyReleaseAbs, { recursive: true });
  await ensureSymlink(publishRootAbs, emptyReleaseAbs);
  await ensureSymlink(activeReleaseAbs, publishRootAbs);
}

export function nixosSharedHostContainerRoot(hostRoot: string, containerName: string): string {
  return containerRoot(hostRoot, containerName);
}

export async function materializeNixosSharedHostRuntime(
  hostRoot: string,
  config: NixosSharedHostConfig,
): Promise<void> {
  await fsp.mkdir(path.join(hostRoot, "containers"), { recursive: true });
  for (const container of Object.values(config.containers)) {
    await materializeContainerRoot(
      hostRoot,
      container.containerName,
      container.releaseRoot,
      container.activeReleaseLink,
      container.publishRoot,
    );
  }
}
