#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { viberootsDevTool, viberootsTool } from "./lib/viberoots-tools";

// Ensure dev env tooling (yaml parser, zx deps) is exported in temp repos
process.env.TEST_NEED_DEV_ENV = "1";

async function assertImmutableWorkspaceAuthority(root: string, phase: string): Promise<void> {
  const workspace = path.join(root, ".viberoots", "workspace");
  const flake = await fsp.readFile(path.join(workspace, "flake.nix"), "utf8");
  const lock = JSON.parse(await fsp.readFile(path.join(workspace, "flake.lock"), "utf8")) as {
    nodes?: {
      viberoots?: {
        locked?: { path?: string };
        original?: { path?: string };
      };
    };
  };
  const declared = flake.match(/\bviberoots\.url\s*=\s*"path:([^"]+)"/)?.[1] || "";
  const locked = lock.nodes?.viberoots?.locked?.path || "";
  const original = lock.nodes?.viberoots?.original?.path || "";
  assert.match(declared, /^\/nix\/store\/[a-z0-9]{32}-source$/, `${phase}: flake authority`);
  assert.equal(locked, declared, `${phase}: locked authority`);
  assert.equal(original, declared, `${phase}: original authority`);
}

test("node cli: scaffold, build shim, run help", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "viberoots";
  }
  try {
    await runInTemp("node-cli-scaffold-shim", async (tmp, $) => {
      await assertImmutableWorkspaceAuthority(tmp, "entry");
      await $`git init`;
      await $`scaf new ts cli demo --yes --skip-lockfile-gen`;
      await assertImmutableWorkspaceAuthority(tmp, "after scaf");
      assert.match(
        await fsp.readFile(path.join(tmp, "viberoots/build-tools/tools/bin/build"), "utf8"),
        /export VBR_DEVSHELL_USE_GENERATED_AUTHORITY=1[\s\S]*devshell\.sh/,
        "temp repo build wrapper must select generated authority before devshell entry",
      );
      const target = "//projects/apps/demo:demo";
      const buildTool = viberootsTool("build-tools/tools/bin/b");
      const artifactCommandEnv = () => {
        const env = withoutArtifactEnvironmentInfluence(process.env);
        delete env.IN_NIX_SHELL;
        delete env.NO_DEV_SHELL;
        env.PATH = [path.join(canonicalArtifactToolsRoot(tmp), "bin"), env.PATH || ""]
          .filter(Boolean)
          .join(path.delimiter);
        return env;
      };
      const staleBuild = await $({
        cwd: tmp,
        stdio: "pipe",
        env: artifactCommandEnv(),
        reject: false,
        nothrow: true,
      })`${buildTool} ${target}`;
      assert.notEqual(staleBuild.exitCode, 0, "b must fail closed before explicit reconciliation");
      assert.match(
        String(staleBuild.stderr || staleBuild.stdout || ""),
        /tracked pnpm hash metadata is stale for projects\/apps\/demo\/pnpm-lock\.yaml[\s\S]*repair: run u/,
      );
      await assertImmutableWorkspaceAuthority(tmp, "after failed b");
      await reconcileTempDependencyInputs(tmp, $);
      await assertImmutableWorkspaceAuthority(tmp, "after u");
      // Ensure Buck sees the new target
      await $`buck2 targets ${target}`;
      // Glue (target-scoped refresh so graph includes the newly scaffolded target)
      await $`BUCK_TARGET=${target} zx-wrapper ${viberootsDevTool("install-deps.ts")} --glue-only`;
      // Ensure Node providers are synced via orchestrator (primary path)
      await $`node ${viberootsTool("viberoots/build-tools/tools/buck/sync-providers.ts")} --lang=node`;
      await assertImmutableWorkspaceAuthority(tmp, "after glue");
      await $`buck2 targets ${target}`;
      // Public b remains read-only and succeeds after explicit u reconciliation.
      await $({ env: artifactCommandEnv() })`${buildTool} ${target}`;
      await assertImmutableWorkspaceAuthority(tmp, "after final b");
      // Run help
      await $`node projects/apps/demo/bin/demo --help`;
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
