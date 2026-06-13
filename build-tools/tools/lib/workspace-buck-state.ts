#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { DEFAULT_GRAPH_PATH, WORKSPACE_BUCK_STATE_DIR } from "./workspace-state-paths";

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
  await fsp.mkdir(dir, { recursive: true });
  await writeIfMissing(path.join(dir, ".buckconfig"), "[buildfile]\nname = TARGETS\n");
  await writeIfMissing(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "[]\n");
  await writeIfChanged(path.join(dir, "workspace-root.env"), `WORKSPACE_ROOT=${workspaceRoot}\n`);
  await writeIfMissing(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "export_file")',
      "",
      'export_file(name = "graph.json", src = "graph.json", visibility = ["PUBLIC"])',
      'export_file(name = "workspace-root.env", src = "workspace-root.env", visibility = ["PUBLIC"])',
      "",
    ].join("\n"),
  );
}
