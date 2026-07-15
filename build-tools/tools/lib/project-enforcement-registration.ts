import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";
import { resolveWorkspaceRootsSync } from "./repo";
import { WORKSPACE_BUCK_STATE_DIR } from "./workspace-state-paths";

export const PROJECT_ENFORCEMENT_SUFFIX = ".project-enforcement.test.ts";
export const PROJECT_ENFORCEMENT_LABEL = "verify:project-enforcement";
const RUNNER_DIR = "build-tools/tools/project-enforcement";

export type ProjectEnforcementRunner = {
  name: string;
  sourceLabel: string;
  sourcePath: string;
};

function targetName(filename: string): string {
  const stem = filename.slice(0, -PROJECT_ENFORCEMENT_SUFFIX.length);
  return `project_enforcement_${stem.replace(/[^A-Za-z0-9_]+/g, "_")}`;
}

export async function discoverProjectEnforcementRunners(
  viberootsRoot: string,
): Promise<ProjectEnforcementRunner[]> {
  const dir = path.join(viberootsRoot, RUNNER_DIR);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_ENFORCEMENT_SUFFIX))
    .map((entry) => ({
      name: targetName(entry.name),
      sourceLabel: `@viberoots//${RUNNER_DIR}:${entry.name}`,
      sourcePath: path.join(dir, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function renderWorkspaceBuckTargets(runners: readonly ProjectEnforcementRunner[]): string {
  const lines = [
    'load("@prelude//:rules.bzl", "export_file")',
    'load("@viberoots//build-tools/tools/buck:zx_test.bzl", "zx_test")',
    "",
    'export_file(name = "graph.json", src = "graph.json", visibility = ["PUBLIC"])',
    'export_file(name = "workspace-root.env", src = "workspace-root.env", visibility = ["PUBLIC"])',
  ];
  for (const runner of runners) {
    lines.push(
      "",
      "zx_test(",
      `    name = ${JSON.stringify(runner.name)},`,
      '    script = "@viberoots//:project-enforcement-runner.ts",',
      `    out = ${JSON.stringify(`${runner.name}.stamp`)},`,
      `    labels = [${JSON.stringify(PROJECT_ENFORCEMENT_LABEL)}],`,
      `    template_inputs = [${JSON.stringify(runner.sourceLabel)}],`,
      "    test_rule_timeout_ms = 30 * 1000,",
      ")",
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function ensureProjectEnforcementRegistration(opts?: {
  workspaceRoot?: string;
  viberootsRoot?: string;
}): Promise<ProjectEnforcementRunner[]> {
  const roots =
    opts?.workspaceRoot && opts?.viberootsRoot
      ? null
      : resolveWorkspaceRootsSync({ start: opts?.workspaceRoot || process.cwd() });
  const workspaceRoot = path.resolve(opts?.workspaceRoot || roots!.workspaceRoot);
  const viberootsRoot = path.resolve(opts?.viberootsRoot || roots!.viberootsRoot);
  const runners = await discoverProjectEnforcementRunners(viberootsRoot);
  if (runners.length === 0) {
    throw new Error(
      `project enforcement registration found no ${PROJECT_ENFORCEMENT_SUFFIX} runners`,
    );
  }
  const dir = path.join(workspaceRoot, WORKSPACE_BUCK_STATE_DIR);
  await mkdirWithMacosMetadataExclusion(dir);
  await writeIfChanged(path.join(dir, "TARGETS"), renderWorkspaceBuckTargets(runners));
  return runners;
}
