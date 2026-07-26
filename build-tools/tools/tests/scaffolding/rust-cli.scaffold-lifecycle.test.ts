#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";
import { readGlobalNixInputTargets } from "../../lib/global-nix-input-targets";

process.env.TEST_NEED_DEV_ENV = "1";

async function assertGlobalNixInputTargetsFresh(consumer: string, phase: string): Promise<void> {
  const expected = await readGlobalNixInputTargets(consumer);
  const checks = [
    ["projects/config/TARGETS", expected.projectsConfigTargets],
    [".viberoots/workspace/TARGETS", expected.workspaceTargets],
  ] as const;
  for (const [relative, contents] of checks) {
    const current = await fs.readFile(path.join(consumer, relative), "utf8").catch(() => "");
    assert.equal(current === contents, true, `${relative} is stale after ${phase}`);
  }
}

test(
  "Rust CLI scaffold completes update, install, build, verify, and runnable lifecycle",
  { timeout: 1_200_000 },
  async () => {
    await runInScratchTemp("rust-cli-scaffold-lifecycle", async (tmp, $) => {
      const source = await makeRemoteSource(tmp, $);
      const consumer = await makeConsumer(tmp, "rust-cli-consumer", source, $);
      try {
        const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
        for (let attempt = 0; attempt < 2; attempt++) {
          await $({
            cwd: consumer,
            env: { ...process.env, WORKSPACE_ROOT: consumer, VBR_NIX_CACHE_POLICY: "off" },
            stdio: "pipe",
          })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
        }
        const sourcePath = await fs.realpath(path.join(consumer, ".viberoots", "current"));
        const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => {
          const env = commandEnv(consumer, extra);
          delete env.VERIFY_SKIP_LINT;
          env.VBR_NIX_CACHE_POLICY = "auto";
          return env;
        };
        await $({ cwd: consumer, env: lifecycleEnv() })`scaf new rust cli rust_demo --yes`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
        await $({
          cwd: consumer,
          env: lifecycleEnv(),
        })`git add projects/apps/rust_demo`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m rust-scaffold`;

        await $({
          cwd: consumer,
          env: lifecycleEnv({ VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath }),
        })`u`;
        await assertGlobalNixInputTargetsFresh(consumer, "update");
        await $({ cwd: consumer, env: lifecycleEnv() })`i --without-secrets`;
        await assertGlobalNixInputTargetsFresh(consumer, "install");

        await $({
          cwd: consumer,
          env: lifecycleEnv(),
        })`b //projects/apps/rust_demo:rust_demo`;
        await assertGlobalNixInputTargetsFresh(consumer, "build");
        await $({
          cwd: consumer,
          env: lifecycleEnv(),
        })`v //projects/apps/rust_demo:rust_demo-test`;
        const run = await $({
          cwd: consumer,
          env: lifecycleEnv(),
        })`p //projects/apps/rust_demo:rust_demo`;
        assert.match(String(run.stdout), /hello from rust_demo/);
        const readme = await fs.readFile(
          path.join(consumer, "projects/apps/rust_demo/README.md"),
          "utf8",
        );
        assert.match(readme, /use `i`, `b`, `v`, and `p`/);
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
