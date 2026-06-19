#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

process.env.TEST_RSYNC_ROOTS = process.env.TEST_RSYNC_ROOTS || "viberoots toolchains";

async function nixPathInfoOrBuild(root: string, $: any, attr: string): Promise<string> {
  const flakeRef = `path:${await workspaceFlakeRef(root)}#${attr}`;
  const info = await $({
    cwd: root,
    stdio: "pipe",
  })`nix path-info ${flakeRef} --json --accept-flake-config`.nothrow();
  if (info.exitCode === 0) {
    const txt = String(info.stdout || "").trim();
    if (txt.startsWith("[")) {
      const arr = JSON.parse(txt) as Array<string | { path?: string }>;
      const first = arr[0];
      const pathInfo = typeof first === "string" ? first : String(first?.path || "");
      if (pathInfo) {
        const exists = await fsp
          .access(pathInfo)
          .then(() => true)
          .catch(() => false);
        if (exists) return pathInfo;
      }
    }
  }
  const res = await $({
    cwd: root,
    stdio: "pipe",
  })`nix build ${flakeRef} --no-link --print-out-paths --accept-flake-config`;
  const outPath =
    String(res.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  if (!outPath) {
    throw new Error(`nix build returned no output path for ${attr}`);
  }
  return outPath;
}

test("toolchains.go and toolchains.python build and expose binaries", async () => {
  await runInTemp("toolchains-nix-build", async (tmp, $) => {
    const root = tmp;
    await fsp.access(path.join(root, ".viberoots", "workspace", "flake.nix"));

    const goOut = await nixPathInfoOrBuild(root, $, "toolchains.go");
    const pyOut = await nixPathInfoOrBuild(root, $, "toolchains.python");

    await fsp.access(path.join(goOut, "bin", "go"));
    await fsp.access(path.join(pyOut, "bin", "python3"));

    assert.ok(goOut.includes("/nix/store/"));
    assert.ok(pyOut.includes("/nix/store/"));
  });
});
