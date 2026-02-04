#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findNearestLockfileForPackage } from "../../lib/importers.ts";

test("findNearestLockfileForPackage returns nearest ancestor lockfile path within repo root", async () => {
  await runInTemp("importers-nearest-lockfile", async (tmp) => {
    const outer = path.join(tmp, "outer");
    const repo = path.join(outer, "repo");

    await fs.mkdirp(path.join(repo, "apps", "web", "nested"));
    await fs.mkdirp(path.join(repo, "libs", "api", "inner"));

    await fs.outputFile(path.join(outer, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fs.outputFile(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fs.outputFile(path.join(repo, "uv.lock"), "# root uv\n", "utf8");
    await fs.outputFile(
      path.join(repo, "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf8",
    );
    await fs.outputFile(path.join(repo, "libs", "api", "uv.lock"), "# api uv\n", "utf8");

    const prevCwd = process.cwd();
    try {
      process.chdir(repo);

      assert.equal(
        await findNearestLockfileForPackage({
          pkgDir: "apps/web/nested",
          lockfileBasename: "pnpm-lock.yaml",
        }),
        "apps/web/pnpm-lock.yaml",
      );

      assert.equal(
        await findNearestLockfileForPackage({
          pkgDir: "libs/api/inner",
          lockfileBasename: "uv.lock",
        }),
        "libs/api/uv.lock",
      );

      assert.equal(
        await findNearestLockfileForPackage({
          pkgDir: "libs/api/inner",
          lockfileBasename: "pnpm-lock.yaml",
        }),
        "pnpm-lock.yaml",
      );

      assert.equal(
        await findNearestLockfileForPackage({
          pkgDir: "..",
          lockfileBasename: "pnpm-lock.yaml",
        }),
        null,
      );
    } finally {
      process.chdir(prevCwd);
    }
  });
});
