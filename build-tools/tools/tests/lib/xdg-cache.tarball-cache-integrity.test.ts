#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { ensureSharedNixTarballCacheRepo } from "./test-helpers/xdg-cache";

async function makeTempXdgCacheRoot(): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-xdg-cache-test-"));
}

test("ensureSharedNixTarballCacheRepo removes an invalid tarball cache repo", async () => {
  const xdgCacheHome = await makeTempXdgCacheRoot();
  const repoPath = path.join(xdgCacheHome, "nix", "tarball-cache-v2");
  try {
    await fsp.mkdir(path.join(repoPath, "objects"), { recursive: true });
    await fsp.mkdir(path.join(repoPath, "refs"), { recursive: true });
    await fsp.writeFile(path.join(repoPath, "HEAD"), "not-a-valid-head\n", "utf8");

    await ensureSharedNixTarballCacheRepo(xdgCacheHome);

    const stat = await fsp.stat(repoPath).catch(() => null);
    assert.equal(stat, null);
  } finally {
    await fsp.rm(xdgCacheHome, { recursive: true, force: true });
  }
});

test("ensureSharedNixTarballCacheRepo preserves a valid bare tarball cache repo", async () => {
  const xdgCacheHome = await makeTempXdgCacheRoot();
  const repoPath = path.join(xdgCacheHome, "nix", "tarball-cache-v2");
  try {
    await fsp.mkdir(path.dirname(repoPath), { recursive: true });
    const init = spawnSync("git", ["init", "--bare", repoPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(init.status, 0, init.stderr || init.stdout || "git init --bare failed");

    await ensureSharedNixTarballCacheRepo(xdgCacheHome);

    const probe = spawnSync("git", ["-C", repoPath, "rev-parse", "--is-bare-repository"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(probe.status, 0, probe.stderr || probe.stdout || "git rev-parse failed");
    assert.equal(String(probe.stdout || "").trim(), "true");
  } finally {
    await fsp.rm(xdgCacheHome, { recursive: true, force: true });
  }
});
