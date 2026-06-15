#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_SCRIPT = new URL("../../dev/viberoots.ts", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout || "").trim();
}

async function initGitRepo(root: string): Promise<string> {
  await git(["init"], root);
  await fsp.writeFile(path.join(root, "README.md"), "fixture\n", "utf8");
  await git(["add", "README.md"], root);
  await git(
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
    root,
  );
  return await git(["rev-parse", "HEAD"], root);
}

test("viberoots status reports local live checkout and extraction blockers", async () => {
  const root = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-status-extraction-")),
  );
  try {
    const source = path.join(root, "viberoots");
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
    await fsp.mkdir(source, { recursive: true });
    const rev = await initGitRepo(source);
    await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.symlink("../viberoots", path.join(root, ".viberoots", "current"));

    const { stdout } = await execFileAsync("zx-wrapper", [VERSION_SCRIPT, "status", "--json"], {
      cwd: process.cwd(),
      env: { ...process.env, WORKSPACE_ROOT: root, VIBEROOTS_ROOT: "", NO_DEV_SHELL: "1" },
    });

    const status = JSON.parse(String(stdout));
    assert.equal(status.sourceMode, "local");
    assert.equal(status.viberootsRoot, source);
    assert.equal(status.revision, rev);
    assert.equal(status.currentPointsToLiveCheckout, true);
    assert.deepEqual(
      status.extractionBlockers.map((b: { kind: string; path: string }) => `${b.kind}:${b.path}`),
      ["path:build-tools"],
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
