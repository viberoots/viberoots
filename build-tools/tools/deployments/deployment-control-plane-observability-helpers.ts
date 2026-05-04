#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  createReferenceOnlyPayload,
  type DeploymentOperatorVisiblePayload,
} from "./deployment-control-plane-redaction";

export type ObservabilityArtifactRefsInput = {
  replaySnapshotPath?: string;
  provisionerPlan?: { artifactPath?: string };
  controlPlane?: { executionSnapshotPath?: string };
  breakGlass?: { evidencePath?: string };
};

export async function readJsonDir<T>(dir: string): Promise<T[]> {
  try {
    const names = (await fsp.readdir(dir)).filter((name) => name.endsWith(".json")).sort();
    return await Promise.all(
      names.map(async (name) => JSON.parse(await fsp.readFile(path.join(dir, name), "utf8")) as T),
    );
  } catch {
    return [];
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function ageMs(timestamp: string | undefined, now: Date): number | undefined {
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, now.getTime() - parsed) : undefined;
}

export function increment(map: Record<string, number>, key?: string) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

export async function recordRefs(
  run: ObservabilityArtifactRefsInput,
): Promise<DeploymentOperatorVisiblePayload[]> {
  const refs: Array<Promise<DeploymentOperatorVisiblePayload>> = [];
  if (run.replaySnapshotPath) {
    refs.push(createReferenceOnlyPayload(run.replaySnapshotPath, "replay snapshot redacted"));
  }
  if (run.provisionerPlan?.artifactPath) {
    refs.push(
      createReferenceOnlyPayload(run.provisionerPlan.artifactPath, "plan artifact redacted"),
    );
  }
  if (run.controlPlane?.executionSnapshotPath) {
    refs.push(
      createReferenceOnlyPayload(
        run.controlPlane.executionSnapshotPath,
        "execution snapshot redacted",
      ),
    );
  }
  if (run.breakGlass?.evidencePath) {
    refs.push(
      createReferenceOnlyPayload(run.breakGlass.evidencePath, "break-glass evidence redacted"),
    );
  }
  return await Promise.all(refs);
}
