#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { direnvStage0 } from "../../lib/consumer-direnv";

const execFileAsync = promisify(execFile);

test("stage-0 excludes runtime leaves from workspace flake acquisition", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-workspace-flake-state-"));
  try {
    const workspace = path.join(root, ".viberoots", "workspace");
    const direnvrc = path.join(root, "home", ".nix-profile", "share", "nix-direnv", "direnvrc");
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(path.dirname(direnvrc), { recursive: true });
    await fsp.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(workspace, "flake.lock"), "{}\n", "utf8");
    await fsp.writeFile(path.join(workspace, "host-path"), "stale-host-path\n", "utf8");
    await fsp.writeFile(path.join(workspace, "exact-env-smoke.out"), "stale-smoke\n", "utf8");
    await fsp.writeFile(
      direnvrc,
      `watch_file() { :; }
use() {
  test "$1" = flake
  test ! -e "$PWD/.viberoots/workspace/host-path"
  test ! -e "$PWD/.viberoots/workspace/exact-env-smoke.out"
  printf '%s\\n' clean > "$PWD/acquisition-state"
}
`,
      "utf8",
    );
    const stage0 = path.join(root, "stage0.sh");
    await fsp.writeFile(stage0, direnvStage0(), "utf8");

    const captured = "/host/tools/bin:/usr/bin:/bin";
    await execFileAsync("/bin/bash", ["-c", 'source "$1"', "stage0-runtime-test", stage0], {
      cwd: root,
      env: {
        ...process.env,
        HOME: path.join(root, "home"),
        IN_NIX_SHELL: "",
        VBR_DEVSHELL_USE_GENERATED_AUTHORITY: "1",
        VBR_HOST_PATH: captured,
        VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      },
    });

    assert.equal(await fsp.readFile(path.join(root, "acquisition-state"), "utf8"), "clean\n");
    assert.equal(await fsp.readFile(path.join(workspace, "host-path"), "utf8"), `${captured}\n`);
    await assert.rejects(fsp.access(path.join(workspace, "exact-env-smoke.out")), {
      code: "ENOENT",
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ordinary stage-0 preserves generated flake and filtered-input bytes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-workspace-flake-read-only-"));
  try {
    const workspace = path.join(root, ".viberoots", "workspace");
    const filtered = path.join(workspace, "viberoots-flake-input");
    const localSource = path.join(root, "viberoots");
    const direnvrc = path.join(root, "home", ".nix-profile", "share", "nix-direnv", "direnvrc");
    await fsp.mkdir(filtered, { recursive: true });
    await fsp.mkdir(localSource, { recursive: true });
    await fsp.mkdir(path.dirname(direnvrc), { recursive: true });
    const flakeBytes = Buffer.from(
      '{ inputs.viberoots.url = "path:/nix/store/00000000000000000000000000000000-source"; outputs = _: {}; }\n',
    );
    const lockBytes = Buffer.from('{"nodes":{"viberoots":{"locked":{"type":"path"}}}}\n');
    await fsp.writeFile(path.join(workspace, "flake.nix"), flakeBytes);
    await fsp.writeFile(path.join(workspace, "flake.lock"), lockBytes);
    await fsp.writeFile(path.join(filtered, "flake.nix"), "filtered\n");
    await fsp.writeFile(path.join(localSource, "flake.nix"), "local\n");
    await fsp.writeFile(
      direnvrc,
      `watch_file() { :; }
use() { :; }
`,
      "utf8",
    );
    const stage0 = path.join(root, "stage0.sh");
    await fsp.writeFile(stage0, direnvStage0(), "utf8");

    await execFileAsync("/bin/bash", ["-c", 'source "$1"', "stage0-read-only-test", stage0], {
      cwd: root,
      env: {
        ...process.env,
        HOME: path.join(root, "home"),
        IN_NIX_SHELL: "",
        VBR_NIX_CACHE_HEALTH_APPLIED: "1",
        VIBEROOTS_FLAKE_INPUT_ROOT: localSource,
        VIBEROOTS_SOURCE_ROOT: localSource,
      },
    });

    assert.deepEqual(await fsp.readFile(path.join(workspace, "flake.nix")), flakeBytes);
    assert.deepEqual(await fsp.readFile(path.join(workspace, "flake.lock")), lockBytes);
    assert.equal(await fsp.readFile(path.join(filtered, "flake.nix"), "utf8"), "filtered\n");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
