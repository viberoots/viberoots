#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Limit sync to the 'tools' root for this test
process.env.TEST_RSYNC_ROOTS = "tools";

test("rsync: copies only specified roots when TEST_RSYNC_ROOTS=tools", async () => {
  await runInTemp("rsync-roots-tools", async (tmp, $) => {
    async function dirExists(rel: string): Promise<boolean> {
      try {
        const st = await fsp.stat(path.join(tmp, rel));
        return st.isDirectory();
      } catch {
        return false;
      }
    }
    const toolsPresent = await dirExists("tools");
    const docsPresent = await dirExists("docs");
    const goPresent = await dirExists("go");
    if (!toolsPresent) {
      console.error("expected 'tools' to be present in temp copy");
      process.exit(2);
    }
    if (docsPresent || goPresent) {
      console.error("expected 'docs' and 'go' to be absent when TEST_RSYNC_ROOTS=tools, got:", {
        docsPresent,
        goPresent,
      });
      process.exit(2);
    }
  });
});
