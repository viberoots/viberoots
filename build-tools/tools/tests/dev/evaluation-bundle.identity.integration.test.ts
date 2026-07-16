#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";

async function sourceFixture(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "projects", "app"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(root, "flake.lock"), "{}\n");
  await fsp.writeFile(path.join(root, "projects", "app", "main.ts"), "export const n = 1;\n");
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "buck", "graph.json"), "[]\n");
  return root;
}

test("warm and independent copy modes reuse one evaluation bundle NAR identity", async () => {
  const firstRoot = await sourceFixture("evaluation-bundle-identity-a-");
  const secondRoot = await sourceFixture("evaluation-bundle-identity-b-");
  try {
    const first = await materializeEvaluationBundle(
      { stagedSource: firstRoot, attr: "graph-generator", classification: "hermetic" },
      { copyMode: "none" },
    );
    const second = await materializeEvaluationBundle(
      { stagedSource: secondRoot, attr: "graph-generator", classification: "hermetic" },
      { copyMode: "try" },
    );
    assert.equal(second.bundlePath, first.bundlePath);
    assert.equal(second.digest, first.digest);
    const schema = JSON.parse(
      await fsp.readFile(path.join(first.bundlePath, "schema.json"), "utf8"),
    );
    assert.equal(schema.schema, "viberoots.evaluation-bundle.v1");
    assert.equal(schema.digest, first.digest);
  } finally {
    await fsp.rm(firstRoot, { recursive: true, force: true });
    await fsp.rm(secondRoot, { recursive: true, force: true });
  }
});
