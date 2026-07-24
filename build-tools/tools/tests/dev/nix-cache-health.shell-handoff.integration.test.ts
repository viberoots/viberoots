#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { direnvStage0, envrc } from "../../lib/consumer-direnv";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInTemp } from "../lib/test-helpers/run-in-temp";

const execFileAsync = promisify(execFile);

test("actual b reaches Buck with the canonical post-direnv cache config", async () => {
  await runInTemp("cache-health-shell-handoff", async (root) => {
    const stage0Path = path.join(root, ".viberoots/bootstrap/direnv-stage0.sh");
    await fsp.mkdir(path.dirname(stage0Path), { recursive: true });
    await fsp.writeFile(stage0Path, direnvStage0());
    await fsp.writeFile(path.join(root, ".envrc"), envrc());

    const artifactToolsRoot = canonicalArtifactToolsRoot(root);
    const env = withoutArtifactEnvironmentInfluence(process.env);
    delete env.IN_NIX_SHELL;
    delete env.NO_DEV_SHELL;
    delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
    delete env.VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
    env.PATH = [path.join(artifactToolsRoot, "bin"), env.PATH || ""]
      .filter(Boolean)
      .join(path.delimiter);
    env.VBR_GC_MODE = "off";
    env.VBR_NIX_CACHE_POLICY = "auto";

    const direnv = ensureNixStoreToolPathSync("direnv", env);
    const node = ensureNixStoreToolPathSync("node", env);
    await execFileAsync(direnv, ["allow", "."], { cwd: root, env });
    const reviewed = await execFileAsync(
      direnv,
      ["exec", root, node, "-e", "process.stdout.write(process.env.NIX_CONFIG || '')"],
      { cwd: root, env, maxBuffer: 4 * 1024 * 1024 },
    );
    assert.match(reviewed.stdout, /warn-dirty = false/);
    assert.match(reviewed.stdout, /builders =/);

    const build = path.join(root, "viberoots/build-tools/tools/bin/b");
    const result = await execFileAsync(build, ["query", "viberoots//:dev_nix_cache_health"], {
      cwd: root,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
    assert.match(result.stdout, /viberoots\/\/:dev_nix_cache_health/);
  });
});
