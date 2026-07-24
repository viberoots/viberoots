#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PARENT_ROOT = path.dirname(VIBEROOTS_ROOT);

async function configureNxdomainCache(env: NodeJS.ProcessEnv): Promise<void> {
  const home = String(env.HOME || "").trim();
  const realHome = String(env.BUCK2_REAL_HOME || "").trim();
  assert.ok(home);
  assert.ok(realHome);
  const nixDirenvSource = path.join(realHome, ".nix-profile/share/nix-direnv/direnvrc");
  const nixDirenvTarget = path.join(home, ".nix-profile/share/nix-direnv/direnvrc");
  await fsp.access(nixDirenvSource);
  await fsp.mkdir(path.dirname(nixDirenvTarget), { recursive: true });
  await fsp.rm(nixDirenvTarget, { force: true });
  await fsp.symlink(nixDirenvSource, nixDirenvTarget);

  const configRoot = path.join(home, ".config");
  const nixConfig = path.join(configRoot, "nix/nix.conf");
  await fsp.mkdir(path.dirname(nixConfig), { recursive: true });
  await fsp.writeFile(
    nixConfig,
    [
      "extra-substituters = https://optional-cache.invalid/cache",
      "netrc-file = /dev/null",
      "fallback = false",
      "",
    ].join("\n"),
  );
  env.XDG_CONFIG_HOME = configRoot;
}

async function actualParentEnvironment(policy: "auto" | "strict"): Promise<{
  cleanup: () => Promise<void>;
  env: NodeJS.ProcessEnv;
}> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "cache-health-parent-home-"));
  const artifactToolsRoot = canonicalArtifactToolsRoot(PARENT_ROOT);
  const env = withoutArtifactEnvironmentInfluence(process.env);
  env.HOME = home;
  env.BUCK2_REAL_HOME = String(process.env.BUCK2_REAL_HOME || process.env.HOME || "");
  env.IN_NIX_SHELL = "pure";
  delete env.NO_DEV_SHELL;
  delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
  delete env.VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  env.PATH = [path.join(artifactToolsRoot, "bin"), env.PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);
  env.VBR_GC_MODE = "off";
  env.VBR_NIX_CACHE_POLICY = policy;
  delete env.NIX_CONFIG;
  await configureNxdomainCache(env);
  return {
    env,
    cleanup: async () => await fsp.rm(home, { recursive: true, force: true }),
  };
}

test("actual parent b query tolerates a guaranteed NXDOMAIN optional cache", async () => {
  const { env, cleanup } = await actualParentEnvironment("auto");
  try {
    const direnv = ensureNixStoreToolPathSync("direnv", env);
    const node = ensureNixStoreToolPathSync("node", env);
    await execFileAsync(direnv, ["allow", "."], { cwd: PARENT_ROOT, env });
    const reviewed = await execFileAsync(
      direnv,
      ["exec", PARENT_ROOT, node, "-e", "process.stdout.write(process.env.NIX_CONFIG || '')"],
      { cwd: PARENT_ROOT, env, maxBuffer: 4 * 1024 * 1024 },
    );
    assert.match(reviewed.stdout, /warn-dirty = false/);
    assert.match(reviewed.stdout, /builders =/);

    const build = path.join(VIBEROOTS_ROOT, "build-tools/tools/bin/b");
    const result = await execFileAsync(build, ["query", "viberoots//:dev_nix_cache_health"], {
      cwd: PARENT_ROOT,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
    assert.match(result.stdout, /viberoots\/\/:dev_nix_cache_health/);
    assert.match(result.stderr, /disabled unreachable substituter.*optional-cache\.invalid/);
    assert.doesNotMatch(result.stderr, /unable to download .*optional-cache\.invalid/);
  } finally {
    await cleanup();
  }
});

test("actual parent b query rejects the same NXDOMAIN endpoint in strict mode", async () => {
  const { env, cleanup } = await actualParentEnvironment("strict");
  try {
    const direnv = ensureNixStoreToolPathSync("direnv", env);
    await execFileAsync(direnv, ["allow", "."], { cwd: PARENT_ROOT, env });
    const build = path.join(VIBEROOTS_ROOT, "build-tools/tools/bin/b");
    const failure = await execFileAsync(build, ["query", "viberoots//:dev_nix_cache_health"], {
      cwd: PARENT_ROOT,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    }).then(
      () => null,
      (error: { stderr?: string }) => error,
    );
    assert.ok(failure);
    assert.match(String(failure?.stderr || ""), /configured Nix substituter\(s\) unavailable/);
    assert.match(String(failure?.stderr || ""), /optional-cache\.invalid/);
  } finally {
    await cleanup();
  }
});
