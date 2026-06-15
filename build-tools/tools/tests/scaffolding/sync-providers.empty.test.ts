#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function toolScript(tmp: string, rel: string): Promise<string> {
  const local = path.join("build-tools", rel);
  if (
    await fsp
      .access(path.join(tmp, local))
      .then(() => true)
      .catch(() => false)
  ) {
    return local;
  }
  return path.join("viberoots", "build-tools", rel);
}

test("sync-providers: empty repo still generates minimal Node providers file when requested", async () => {
  await runInTemp("sync-empty", async (tmp, $) => {
    await $`node ${await toolScript(tmp, "tools/buck/sync-providers.ts")} --lang node`;
    const txt = await fsp.readFile(
      `${tmp}/.viberoots/workspace/providers/TARGETS.node.auto`,
      "utf8",
    );
    if (!txt.includes("GENERATED FILE — DO NOT EDIT.")) {
      console.error("missing header");
      process.exit(2);
    }
    if (!txt.includes('load("@workspace_providers//:defs_node.bzl", "node_importer_deps")')) {
      console.error("missing node load line");
      process.exit(2);
    }
  });
});
