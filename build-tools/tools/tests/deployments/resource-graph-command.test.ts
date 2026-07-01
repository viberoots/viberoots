#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { DEFAULT_RESOURCE_GRAPH_NODES_PATH } from "../../lib/workspace-state-paths";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";

const execFileAsync = promisify(execFile);

test("viberoots resource-graph command exposes help, completion, and export dispatch", async () => {
  const root = await findViberootsRoot();
  const bin = path.join(root, "build-tools", "tools", "bin", "viberoots");
  const env = { ...process.env, NO_DEV_SHELL: "1", VIBEROOTS_ROOT: root };

  const help = await execFileAsync(bin, ["help", "resource-graph"], { cwd: root, env });
  assert.match(help.stdout, /viberoots resource-graph export/);
  assert.match(help.stdout, /subcommands:\n  export/);

  const resourceGraphHelp = await execFileAsync(bin, ["resource-graph", "--help"], {
    cwd: root,
    env,
  });
  assert.match(resourceGraphHelp.stdout, /viberoots resource-graph export/);
  assert.match(resourceGraphHelp.stdout, /subcommands:\n  export/);

  const exportHelp = await execFileAsync(bin, ["resource-graph", "export", "--help"], {
    cwd: root,
    env,
  });
  assert.match(exportHelp.stdout, /viberoots resource-graph export/);
  assert.doesNotMatch(exportHelp.stdout, /subcommands:/);

  const completion = await execFileAsync(bin, ["completion", "bash"], { cwd: root, env });
  assert.match(completion.stdout, /cmd}" == "resource-graph"/);
  assert.match(completion.stdout, /compgen -W "export --help"/);

  const zshCompletion = await execFileAsync(bin, ["completion", "zsh"], { cwd: root, env });
  assert.match(zshCompletion.stdout, /cmd}" == "resource-graph" && CURRENT == 3/);
  assert.match(zshCompletion.stdout, /_arguments -S "export\[export\]" "--help\[--help\]"/);

  await withTempGraph(async (workspace) => {
    const result = await execFileAsync(
      bin,
      ["resource-graph", "export", "--workspace-root", workspace],
      { cwd: workspace, env },
    );
    assert.match(result.stdout, /resource graph exported:/);
    assert.match(result.stdout, /nodes: \d+/);
    assert.ok(
      JSON.parse(
        await fsp.readFile(path.join(workspace, DEFAULT_RESOURCE_GRAPH_NODES_PATH), "utf8"),
      ),
    );
  });

  await assert.rejects(
    execFileAsync(bin, ["resource-graph"], { cwd: root, env }),
    /requires a subcommand/,
  );
  await assert.rejects(
    execFileAsync(bin, ["resource-graph", "bogus"], { cwd: root, env }),
    /unknown resource-graph subcommand/,
  );
});

async function findViberootsRoot(): Promise<string> {
  for (const candidate of [path.join(process.cwd(), "viberoots"), process.cwd()]) {
    try {
      await fsp.access(path.join(candidate, "init"));
      await fsp.access(path.join(candidate, "build-tools", "tools", "bin", "viberoots"));
      return candidate;
    } catch {}
  }
  throw new Error("could not find viberoots root");
}

async function withTempGraph(fn: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rg-command-")));
  try {
    const graph = path.join(workspace, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graph), { recursive: true });
    await fsp.writeFile(
      graph,
      `${JSON.stringify(
        cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fn(workspace);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

function providerTarget() {
  return { account: "web-platform", project: "pleomino-staging" };
}
