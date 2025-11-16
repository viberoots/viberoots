#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import path from "node:path";
import { maybeAssumeUnchanged } from "../../lib/fs-helpers.ts";
import { runInTemp } from "../lib/test-helpers";

test("maybeAssumeUnchanged: no-throw outside a git work tree", async () => {
  await runInTemp("assume-unchanged-outside-git", async (tmp, $) => {
    const file = path.join(tmp, "third_party/providers/auto_map.bzl");
    // Create parent dir and file so helper has a valid path to reference.
    await $`mkdir -p ${path.dirname(file)}`;
    await $`bash -lc ${`printf '# GENERATED\\nMODULE_PROVIDERS = {}\\n' > ${file}`}`;
    // Should not throw even when not in a git repository.
    await maybeAssumeUnchanged(file);
  });
});
