#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("repo-skills cc workflow guards viberoots consumer metadata before commit", async () => {
  const workflow = await fsp.readFile(
    "viberoots/plugins/repo-skills/skills/cc/WORKFLOW.md",
    "utf8",
  );
  for (const fragment of [
    "zx-wrapper viberoots/build-tools/tools/dev/consumer-consistency-check.ts",
    "viberoots update",
    "gitlink_rev",
    "flake.lock",
    "pnpm hash metadata",
    "--read-only",
    "post-clone",
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`cc workflow must guard viberoots consumer commits; missing ${fragment}`);
    }
  }
});
