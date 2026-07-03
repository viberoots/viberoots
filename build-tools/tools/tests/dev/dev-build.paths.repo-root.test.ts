#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { repoRoot } from "../../dev/dev-build/paths";

test("dev-build repoRoot resolves nested viberoots checkout to consumer workspace root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-repo-root-"));
  const workspace = path.join(tmp, "workspace");
  const nested = path.join(workspace, "viberoots", "build-tools", "tools");
  await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
  await fsp.writeFile(
    path.join(workspace, ".viberoots", "workspace", "flake.nix"),
    "{ outputs = { self }: {}; }\n",
    "utf8",
  );
  await fsp.mkdir(nested, { recursive: true });

  const priorCwd = process.cwd();
  const priorWorkspaceRoot = process.env.WORKSPACE_ROOT;
  try {
    process.chdir(nested);
    delete process.env.WORKSPACE_ROOT;
    assert.equal(repoRoot(), await fsp.realpath(workspace));
  } finally {
    process.chdir(priorCwd);
    if (priorWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = priorWorkspaceRoot;
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
