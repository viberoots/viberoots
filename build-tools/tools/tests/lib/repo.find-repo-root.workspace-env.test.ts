#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { findRepoRoot } from "../../lib/repo.ts";
import { runInTemp } from "./test-helpers";

test("findRepoRoot prefers WORKSPACE_ROOT when temp-workspace commands run under a nested repo path", async () => {
  await runInTemp("repo-find-root-workspace-env", async (tmp) => {
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    const nested = path.join(tmp, "projects", "deployments", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const previous = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = tmp;
    try {
      assert.equal(await findRepoRoot(nested), tmp);
    } finally {
      if (typeof previous === "string") process.env.WORKSPACE_ROOT = previous;
      else delete process.env.WORKSPACE_ROOT;
    }
  });
});
