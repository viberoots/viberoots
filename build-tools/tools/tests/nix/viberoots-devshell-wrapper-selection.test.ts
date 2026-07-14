#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function writeMinimalSource(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, "build-tools", "tools", "dev"), { recursive: true });
  await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"), "");
}

test("devshell wrapper prefers workspace current over stale source env", async () => {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-shell-")));
  const currentSource = path.join(workspace, "current-source");
  const staleSource = path.join(workspace, "stale-source");
  try {
    await fsp.mkdir(path.join(workspace, ".viberoots"), { recursive: true });
    await writeMinimalSource(currentSource);
    await writeMinimalSource(staleSource);
    await fsp.symlink(currentSource, path.join(workspace, ".viberoots", "current"));

    const script = `
set -euo pipefail
cd "${workspace}"
export WORKSPACE_ROOT="${workspace}"
export VIBEROOTS_SOURCE_ROOT="${staleSource}"
. "${viberootsSourcePath("viberoots/build-tools/tools/bin/devshell.sh")}"
printf '%s\\n' "$VIBEROOTS_ROOT"
`;
    const selected = execFileSync("bash", ["--noprofile", "--norc", "-c", script], {
      encoding: "utf8",
    }).trim();

    assert.equal(selected, path.join(workspace, ".viberoots", "current"));
    assert.notEqual(selected, staleSource);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});
