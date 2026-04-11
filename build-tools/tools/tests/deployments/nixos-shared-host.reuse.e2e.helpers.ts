#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";

export async function writeArtifact(root: string, marker: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

export async function writeDeploymentJson(filePath: string, deployment: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

export async function writeAdmissionEvidenceJson(opts: {
  tmp: string;
  $: any;
  deploymentJson: string;
  deployment: unknown;
}): Promise<string> {
  return await writeReviewedLaneAdmissionEvidenceJson(opts);
}

export function liveRootPath(hostRoot: string, containerName: string): string {
  return path.join(nixosSharedHostContainerRoot(hostRoot, containerName), "srv/static-app/live");
}

export function liveIndexPath(hostRoot: string, containerName: string): string {
  return path.join(liveRootPath(hostRoot, containerName), "index.html");
}

export function componentArtifactFlag(artifacts: Record<string, string>): string {
  return Object.entries(artifacts)
    .map(([componentId, artifactDir]) => `${componentId}=${artifactDir}`)
    .join(",");
}
