#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInTemp } from "../lib/test-helpers";

const startupCheckScript = fileURLToPath(new URL("../../dev/startup-check.ts", import.meta.url));

async function writeBuckState(root: string, extraCells: string[] = []): Promise<void> {
  await fs.remove(path.join(root, "prelude"));
  await fs.remove(path.join(root, "viberoots"));
  await fs.outputFile(path.join(root, "viberoots/prelude/prelude.bzl"), "# prelude\n", "utf8");
  await fs.outputFile(path.join(root, "viberoots/flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fs.ensureDir(path.join(root, ".viberoots"));
  await fs.remove(path.join(root, ".viberoots/current"));
  await fs.symlink("../viberoots", path.join(root, ".viberoots/current"));
  await fs.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fs.writeFile(
    path.join(root, ".buckconfig"),
    [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "prelude = ./.viberoots/current/prelude",
      ...extraCells,
      "",
      "[cells]",
      "root = .",
      "prelude = ./.viberoots/current/prelude",
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
  })`zx-wrapper ${startupCheckScript}`;
}

function assertFailed(res: { exitCode: number; stderr: string }, pattern: RegExp): void {
  if (res.exitCode === 0 || !pattern.test(String(res.stderr))) {
    throw new Error(`expected startup-check failure ${pattern}\nstderr:\n${res.stderr}`);
  }
}

await runInTemp("startup-check-viberoots-activation", async (tmp) => {
  const workspace = path.join(tmp, "workspace");
  await fs.ensureDir(workspace);

  await writeBuckState(workspace);
  await fs.remove(path.join(workspace, ".buckroot"));
  assertFailed(await runStartup(workspace), /\.buckroot not found/);

  await writeBuckState(workspace);
  await fs.writeFile(
    path.join(workspace, "flake.nix"),
    '{ inputs.viberoots.url = "path:./viberoots"; outputs = _: {}; }\n',
    "utf8",
  );
  await fs.remove(path.join(workspace, "viberoots"));
  assertFailed(await runStartup(workspace), /viberoots submodule is missing or uninitialized/);

  await fs.outputFile(
    path.join(workspace, "viberoots/flake.nix"),
    "{ outputs = _: {}; }\n",
    "utf8",
  );
  await fs.outputFile(path.join(workspace, "viberoots/prelude/prelude.bzl"), "# prelude\n", "utf8");
  await fs.outputFile(
    path.join(workspace, "stale-viberoots/flake.nix"),
    "{ outputs = _: {}; }\n",
    "utf8",
  );
  await fs.ensureDir(path.join(workspace, ".viberoots"));
  await fs.remove(path.join(workspace, ".viberoots/current"));
  await fs.symlink("../stale-viberoots", path.join(workspace, ".viberoots/current"));
  assertFailed(await runStartup(workspace), /\.viberoots\/current points at/);

  await fs.remove(path.join(workspace, ".viberoots/current"));
  await fs.symlink("..", path.join(workspace, ".viberoots/current"));
  assertFailed(await runStartup(workspace), /\.viberoots\/current points at/);

  await fs.remove(path.join(workspace, "viberoots"));
  await fs.symlink("../viberoots", path.join(workspace, "viberoots"));
  await fs.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fs.remove(path.join(workspace, ".viberoots/current"));
  await fs.symlink("../viberoots", path.join(workspace, ".viberoots/current"));
  let res = await runStartup(workspace);
  if (res.exitCode !== 0) throw new Error(`expected extracted current to pass\n${res.stderr}`);

  await writeBuckState(workspace, ["viberoots = ./.viberoots/current/missing-viberoots-cell"]);
  await fs.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  assertFailed(await runStartup(workspace), /references missing cell path/);
});
