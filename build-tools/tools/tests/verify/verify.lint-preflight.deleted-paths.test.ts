#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  filterExistingLintPreflightPaths,
  resolveLintPreflightFilterPaths,
} from "../../dev/verify/lint-preflight-paths";
import { runInTemp } from "../lib/test-helpers";

test("lint preflight excludes deleted changed paths before invoking formatters", async () => {
  await runInTemp("lint-preflight-deleted-paths", async (tmp) => {
    await fsp.mkdir(path.join(tmp, "src"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "src", "kept.ts"), "export const kept = true;\n");

    const paths = await filterExistingLintPreflightPaths(tmp, [
      "src/kept.ts",
      "src/deleted.ts",
      "src",
    ]);

    assert.deepEqual(paths, ["src/kept.ts"]);
  });
});

test("lint preflight expands project selector directories to existing files before ignore filtering", async () => {
  await runInTemp("lint-preflight-empty-projects", async (tmp) => {
    await fsp.mkdir(path.join(tmp, "projects", "config"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "projects", "config", "shared.json"), "{}\n");

    const paths = await resolveLintPreflightFilterPaths(tmp, ["./projects"]);

    assert.deepEqual(paths, ["projects/config/shared.json"]);
  });
});
