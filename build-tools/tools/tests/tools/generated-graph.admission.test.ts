#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { requireGeneratedGraph } from "../../buck/generated-graph";
import { materializeSelectedGraph } from "../../buck/glue-run";

async function tree(root: string): Promise<string[]> {
  const entries: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      entries.push(path.relative(root, full));
      if (entry.isDirectory()) await visit(full);
    }
  };
  await visit(root);
  return entries.sort();
}

test("generated graph admission rejects stale state without mutation", async () => {
  for (const fixture of [
    { name: "missing", contents: undefined, target: "" },
    { name: "empty", contents: "[]\n", target: "" },
    { name: "invalid", contents: "not json\n", target: "" },
    {
      name: "target-missing",
      contents: JSON.stringify({ nodes: [{ name: "root//projects/apps/other:app" }] }) + "\n",
      target: "//projects/apps/demo:app",
    },
  ]) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), `generated-graph-${fixture.name}-`));
    const graphPath = path.join(root, ".viberoots/workspace/buck/graph.json");
    if (fixture.contents !== undefined) {
      await fsp.mkdir(path.dirname(graphPath), { recursive: true });
      await fsp.writeFile(graphPath, fixture.contents);
    }
    const before = await tree(root);
    await assert.rejects(
      requireGeneratedGraph({ graphPath, target: fixture.target }),
      new RegExp(`generated Buck graph is ${fixture.name}[\\s\\S]*repair: run u`),
    );
    assert.deepEqual(await tree(root), before);
  }
});

test("generated graph admission accepts a declared target without rewriting", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "generated-graph-ready-"));
  const graphPath = path.join(root, "graph.json");
  await fsp.writeFile(
    graphPath,
    JSON.stringify({ nodes: [{ name: "root//projects/apps/demo:app (cfg//default)" }] }) + "\n",
  );
  const before = await fsp.readFile(graphPath, "utf8");
  const mtime = (await fsp.stat(graphPath)).mtimeMs;
  await requireGeneratedGraph({ graphPath, target: "//projects/apps/demo:app" });
  assert.equal(await fsp.readFile(graphPath, "utf8"), before);
  assert.equal((await fsp.stat(graphPath)).mtimeMs, mtime);
});

test("selected builds require the declared graph authority without mutation", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "generated-graph-selected-"));
  const stateRoot = path.join(root, ".viberoots/workspace/buck");
  const graphPath = path.join(stateRoot, "graph.json");
  const target = "//projects/apps/demo:app";
  await fsp.mkdir(stateRoot, { recursive: true });
  await fsp.writeFile(graphPath, JSON.stringify({ nodes: [{ name: `root${target}` }] }) + "\n");
  const before = await fsp.readFile(graphPath, "utf8");

  await materializeSelectedGraph({
    workspaceRoot: root,
    graphPath,
    target,
    exportGraph: async () => assert.fail("read-only materialization must not export a graph"),
  });

  assert.equal(await fsp.readFile(graphPath, "utf8"), before);
  await assert.rejects(fsp.access(path.join(stateRoot, "TARGETS")));
});
