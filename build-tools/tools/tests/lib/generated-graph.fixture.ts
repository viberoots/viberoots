#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { artifactGraphQueryRoots } from "../../buck/artifact-graph-query-roots";
import { reconcileGeneratedGraph } from "../../buck/glue-run";
import { stableBuckIsolation } from "../../lib/buck-command-env";

const ANCHOR_DIR = path.join("projects", "libs", "vbr-generated-graph-fixture-anchor");
const ANCHOR_TARGETS = [
  'load("@prelude//:rules.bzl", "filegroup")',
  "",
  "filegroup(",
  '    name = "generated_graph_fixture_anchor",',
  '    srcs = ["anchor.txt"],',
  '    visibility = ["PUBLIC"],',
  ")",
  "",
].join("\n");
const ANCHOR_SOURCE = "generated graph fixture anchor\n";

async function writeReservedFixtureFile(filePath: string, expected: string): Promise<void> {
  const existing = await fsp.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing === expected) return;
  if (existing !== undefined) {
    throw new Error(`reserved generated-graph fixture path has conflicting content: ${filePath}`);
  }
  await fsp.writeFile(filePath, expected, { encoding: "utf8", flag: "wx" });
}

export async function reconcileSyntheticGeneratedGraph(
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const anchorRoot = path.join(workspaceRoot, ANCHOR_DIR);
  await fsp.mkdir(anchorRoot, { recursive: true });
  await writeReservedFixtureFile(path.join(anchorRoot, "TARGETS"), ANCHOR_TARGETS);
  await writeReservedFixtureFile(path.join(anchorRoot, "anchor.txt"), ANCHOR_SOURCE);

  const isolation = stableBuckIsolation(workspaceRoot, "zxtest-generated-graph");
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    BUCK_ISOLATION_DIR: isolation,
    BUCK_NESTED_ISO: isolation,
    BUCK_ISOLATION_DIR_EXPORTER: isolation,
  };
  await reconcileGeneratedGraph({
    workspaceRoot,
    queryRoots: artifactGraphQueryRoots(),
    force: true,
    env,
  });
  return env;
}
