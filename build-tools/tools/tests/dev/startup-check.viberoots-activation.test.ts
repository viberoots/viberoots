#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

async function writeBuckState(root: string, extraCells: string[] = []): Promise<void> {
  await fs.remove(path.join(root, "prelude"));
  await fs.outputFile(path.join(root, "prelude/prelude.bzl"), "# prelude\n", "utf8");
  await fs.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fs.writeFile(
    path.join(root, ".buckconfig"),
    [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "prelude = ./prelude",
      ...extraCells,
      "",
      "[cells]",
      "root = .",
      "prelude = ./prelude",
      ...extraCells,
      "",
      "[build]",
      "prelude = prelude",
      "user_platform = prelude//platforms:default",
      "target_platforms = prelude//platforms:default",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function runStartup(root: string) {
  return await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: { ...process.env, STARTUP_CHECK_ALLOW_NON_NIX_STORE: "1" },
  })`zx-wrapper build-tools/tools/dev/startup-check.ts`;
}

function assertFailed(res: { exitCode: number; stderr: string }, pattern: RegExp): void {
  if (res.exitCode === 0 || !pattern.test(String(res.stderr))) {
    throw new Error(`expected startup-check failure ${pattern}\nstderr:\n${res.stderr}`);
  }
}

await runInTemp("startup-check-viberoots-activation", async (tmp) => {
  await writeBuckState(tmp);
  await fs.remove(path.join(tmp, ".buckroot"));
  assertFailed(await runStartup(tmp), /\.buckroot not found/);

  await writeBuckState(tmp);
  await fs.writeFile(
    path.join(tmp, "flake.nix"),
    '{ inputs.viberoots.url = "path:./viberoots"; outputs = _: {}; }\n',
    "utf8",
  );
  await fs.remove(path.join(tmp, "viberoots"));
  assertFailed(await runStartup(tmp), /missing viberoots\/flake\.nix/);

  await fs.outputFile(path.join(tmp, "viberoots/flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fs.outputFile(
    path.join(tmp, "stale-viberoots/flake.nix"),
    "{ outputs = _: {}; }\n",
    "utf8",
  );
  await fs.ensureDir(path.join(tmp, ".viberoots"));
  await fs.remove(path.join(tmp, ".viberoots/current"));
  await fs.symlink("../stale-viberoots", path.join(tmp, ".viberoots/current"));
  assertFailed(await runStartup(tmp), /\.viberoots\/current points at/);

  await writeBuckState(tmp, ["viberoots = ./.viberoots/current"]);
  await fs.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fs.remove(path.join(tmp, ".viberoots/current"));
  assertFailed(await runStartup(tmp), /references missing cell path/);
});
