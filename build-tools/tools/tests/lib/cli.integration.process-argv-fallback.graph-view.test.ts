#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./test-helpers";
import { runNodeWithZx } from "../../lib/node-run";

test("graph-view: works when zx global argv is absent (process.argv fallback)", async () => {
  await runInTemp("graph-view-cli", async (tmp) => {
    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        { nodes: [{ name: "//projects/apps/demo:demo", labels: ["lang:node"] }] },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const repoRoot = process.cwd();
    const viberootsRoot = path.join(repoRoot, "viberoots");
    const script = path.join(viberootsRoot, "build-tools", "tools", "buck", "graph-view.ts");
    const zxInitPath = path.join(viberootsRoot, "build-tools", "tools", "dev", "zx-init.mjs");
    const res = await runNodeWithZx({
      cwd: tmp,
      zxInitPath,
      script,
      args: ["--graph", graphPath],
      stdio: "pipe",
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        VIBEROOTS_ROOT: viberootsRoot,
        VIBEROOTS_SOURCE_ROOT: viberootsRoot,
      },
    });
    const parsed = JSON.parse(String(res.stdout || "")) as any;
    assert.ok(parsed && typeof parsed === "object");
    assert.ok(Array.isArray(parsed.nodes));
    assert.equal(parsed.nodes[0]?.name, "//projects/apps/demo:demo");
  });
});
