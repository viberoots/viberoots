#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findNearestPnpmLockForPackage } from "../../lib/importers.ts";

test("findNearestPnpmLockForPackage finds the nearest pnpm-lock.yaml and returns a repo-relative POSIX path", async () => {
  await runInTemp("importers-nearest-pnpm-lock", async (tmp) => {
    await fs.mkdirp(path.join(tmp, "apps", "web", "nested"));
    await fs.mkdirp(path.join(tmp, "libs", "api", "inner"));

    await fs.outputFile(
      path.join(tmp, "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf8",
    );
    await fs.outputFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);

      const samePkg = await findNearestPnpmLockForPackage("apps/web");
      assert.equal(samePkg, "apps/web/pnpm-lock.yaml");

      const ancestor = await findNearestPnpmLockForPackage("apps/web/nested");
      assert.equal(ancestor, "apps/web/pnpm-lock.yaml");

      const root = await findNearestPnpmLockForPackage("libs/api/inner");
      assert.equal(root, "pnpm-lock.yaml");

      await fs.remove(path.join(tmp, "apps", "web", "pnpm-lock.yaml"));
      await fs.remove(path.join(tmp, "pnpm-lock.yaml"));
      const none = await findNearestPnpmLockForPackage("apps/web/nested");
      assert.equal(none, null);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
