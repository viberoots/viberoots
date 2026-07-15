#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";
import { DEFAULT_GRAPH_PATH, WORKSPACE_BUCK_STATE_DIR } from "./workspace-state-paths";
import { ensureProjectEnforcementRegistration } from "./project-enforcement-registration";

async function writeIfMissing(file: string, text: string): Promise<void> {
  try {
    await fsp.access(file);
  } catch {
    await writeIfChanged(file, text);
  }
}

export async function ensureWorkspaceBuckStatePackage(
  workspaceRoot = process.cwd(),
): Promise<void> {
  const dir = path.join(workspaceRoot, WORKSPACE_BUCK_STATE_DIR);
  await mkdirWithMacosMetadataExclusion(path.join(workspaceRoot, ".viberoots"));
  await mkdirWithMacosMetadataExclusion(path.dirname(dir));
  await mkdirWithMacosMetadataExclusion(dir);
  await writeIfMissing(path.join(dir, ".buckconfig"), "[buildfile]\nname = TARGETS\n");
  await writeIfMissing(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "[]\n");
  await writeIfChanged(path.join(dir, "workspace-root.env"), `WORKSPACE_ROOT=${workspaceRoot}\n`);
  await ensureProjectEnforcementRegistration({ workspaceRoot });
}
