#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("rsync: copies only specified roots when TEST_RSYNC_ROOTS=build-tools", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  process.env.TEST_RSYNC_ROOTS = "build-tools";
  try {
    await runInTemp("rsync-roots-tools", async (tmp, $) => {
      async function dirExists(rel: string): Promise<boolean> {
        try {
          const st = await fsp.stat(path.join(tmp, rel));
          return st.isDirectory();
        } catch {
          return false;
        }
      }
      const toolsPresent = await dirExists("build-tools");
      const localViberootsPresent = await dirExists("viberoots");
      const docsPresent = await dirExists("docs");
      const goPresent = await dirExists("go");
      if (!toolsPresent) {
        console.error("expected 'build-tools' to be present in temp copy");
        process.exit(2);
      }
      if (docsPresent || goPresent) {
        console.error(
          "expected 'docs' and 'go' to be absent when TEST_RSYNC_ROOTS=build-tools, got:",
          {
            docsPresent,
            goPresent,
          },
        );
        process.exit(2);
      }
      if (!localViberootsPresent) {
        console.error(
          "expected local viberoots flake input to be present with delegated root flake",
        );
        process.exit(2);
      }
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
