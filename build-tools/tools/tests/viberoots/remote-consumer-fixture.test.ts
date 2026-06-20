#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { activateWorkspace } from "../../lib/workspace-activation";
import { remoteSourceStatus } from "../../lib/workspace-remote-source";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  makeConsumer,
  makeConsumerWithFlakeUrl,
  makeRemoteSource,
  REPO_ROOT,
  TEMPLATE_ROOT,
} from "./remote-consumer-fixture-helpers";

const VIBEROOTS_COMMAND = path.join(REPO_ROOT, "build-tools", "tools", "dev", "viberoots.ts");

async function exists(file: string): Promise<boolean> {
  return await fsp
    .stat(file)
    .then(() => true)
    .catch(() => false);
}

function commandEnv(consumer: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const currentToolBin = path.join(consumer, ".viberoots", "current", "build-tools", "tools", "bin");
  const env = {
    ...process.env,
    ...extra,
    WORKSPACE_ROOT: consumer,
    VIBEROOTS_ROOT: "",
    VIBEROOTS_SOURCE_ROOT: "",
    NO_DEV_SHELL: "1",
    VBR_RUN_IN_TEMP_REPO: "1",
    VERIFY_SKIP_LINT: "1",
    VERIFY_ALLOW_CONCURRENT: "1",
    VBR_NIX_CACHE_POLICY: "off",
    BUCK_DEVBUILD_REUSE_DAEMON: "0",
    PATH: `${currentToolBin}:${process.env.PATH || ""}`,
  };
  delete env.BUCK_ISOLATION_DIR;
  return env;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedRealRemoteRequestedRef(ref: string): RegExp {
  const normalized = ref
    .replace(/^git\+/, "")
    .replace(/[?&]rev=[^&]+/, "")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");
  return new RegExp(`^${escapeRegex(normalized)}$`);
}

async function assertCleanConsumerBoundary(consumer: string, sourcePath: string): Promise<void> {
  const forbiddenConsumerPaths = [
    "viberoots",
    "build-tools",
    "build-tools/tmp",
    "flake.nix",
    "flake.lock",
    "pnpm-workspace.yaml",
    "patches",
    "plugins",
    "types",
    "docs",
  ];
  for (const rel of forbiddenConsumerPaths) {
    assert.equal(await exists(path.join(consumer, rel)), false, `unexpected consumer ${rel}`);
  }
  const forbiddenSourceState = [
    ".viberoots",
    "buck-out",
    "build-tools/tmp",
    "projects/node-modules.hashes.json",
    "projects/docs",
  ];
  for (const rel of forbiddenSourceState) {
    assert.equal(await exists(path.join(sourcePath, rel)), false, `unexpected source ${rel}`);
  }
  assert.equal(await exists(path.join(consumer, ".viberoots", "workspace", "providers")), true);
  assert.equal(await exists(path.join(consumer, ".viberoots", "workspace", "buck")), true);
  assert.equal(await exists(path.join(consumer, "projects", "node-modules.hashes.json")), true);
}

async function activateAndAssertStatus(
  consumer: string,
  expectedRequestedRef: RegExp = /^file:\/\/.*remote-viberoots-src/,
): Promise<string> {
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  for (let i = 0; i < 2; i++) {
    await $({
      cwd: consumer,
      env: { ...process.env, WORKSPACE_ROOT: consumer, VBR_NIX_CACHE_POLICY: "off" },
      stdio: "pipe",
    })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
  }
  const activation = await activateWorkspace({
    start: consumer,
    env: { WORKSPACE_ROOT: consumer },
  });
  const status = remoteSourceStatus(consumer);
  assert.ok(status);
  assert.equal(activation.sourcePath, status.sourcePath);
  assert.match(status.sourcePath, /\/nix\/store\//);
  assert.match(status.requestedRef, expectedRequestedRef);
  assert.equal(await fsp.realpath(path.join(consumer, ".viberoots/current")), status.sourcePath);
  const statusJson = await $({
    cwd: consumer,
    env: commandEnv(consumer),
    stdio: "pipe",
  })`zx-wrapper ${VIBEROOTS_COMMAND} status --json`;
  const commandStatus = JSON.parse(String(statusJson.stdout || "{}"));
  assert.equal(commandStatus.sourceMode, "remote");
  assert.equal(commandStatus.requestedRef, status.requestedRef);
  assert.equal(commandStatus.lockedRevision, status.lockedRevision);
  assert.equal(commandStatus.effectiveSourcePath, status.sourcePath);
  assert.equal(commandStatus.currentMatchesLockedSource, true);
  return status.sourcePath;
}

async function runBareCommands(consumer: string, cwd: string): Promise<void> {
  const env = commandEnv(consumer);
  await $({ cwd, env, stdio: "pipe" })`i --glue-only --skip-go-tidy`;
  assert.equal(
    await exists(
      path.join(consumer, ".viberoots", "workspace", "toolchains", "toolchain_paths.bzl"),
    ),
    true,
  );
  await $({
    cwd,
    env,
    stdio: "pipe",
  })`b build --no-materialize //projects/apps/demo:smoke_script`;
  await $({
    cwd,
    env,
    stdio: "pipe",
  })`v //projects/apps/demo:smoke_test`;
  const status = await $({
    cwd,
    env: { ...env, VBR_TAIL_LOG_STATUS_INTERVAL: "1" },
    stdio: "pipe",
    nothrow: true,
  })`timeout 3s s`;
  assert.match(
    String(status.stdout),
    /Runnable targets:|Waiting for filesystem changes|Buck processes:/,
  );
  assert.equal(status.exitCode === 0 || status.exitCode === 124, true);
}

test("committed remote consumer template pins an explicit remote flake lock", async () => {
  const flakePath = path.join(TEMPLATE_ROOT, ".viberoots", "workspace", "flake.nix");
  const lockPath = path.join(TEMPLATE_ROOT, ".viberoots", "workspace", "flake.lock");
  assert.equal(fs.existsSync(lockPath), true);
  assert.match(
    await fsp.readFile(flakePath, "utf8"),
    /git\+ssh:\/\/git@github\.com\/viberoots\/viberoots\.git\?rev=bfe42813eb6c3427d10b219ae83dccbc1b7869f1/,
  );
  const lock = JSON.parse(await fsp.readFile(lockPath, "utf8"));
  assert.equal(lock.nodes.viberoots.original.type, "git");
  assert.equal(lock.nodes.viberoots.original.url, "ssh://git@github.com/viberoots/viberoots.git");
  assert.equal(lock.nodes.viberoots.original.rev, "bfe42813eb6c3427d10b219ae83dccbc1b7869f1");
  assert.equal(lock.nodes.viberoots.locked.rev, "bfe42813eb6c3427d10b219ae83dccbc1b7869f1");
  assert.match(lock.nodes.viberoots.locked.narHash, /^sha256-/);
  assert.notEqual(lock.nodes.viberoots.locked.narHash, "sha256-0000000000000000000000000000000000000000000=");
});

const realRemoteRef = String(process.env.VIBEROOTS_REAL_REMOTE_REF || "").trim();

test(
  "real remote flake ref activates and runs the consumer smoke path",
  { skip: realRemoteRef ? false : "set VIBEROOTS_REAL_REMOTE_REF=github:OWNER/viberoots/REF" },
  async () => {
    await runInScratchTemp("viberoots-real-remote-consumer", async (tmp, $) => {
      const consumer = await makeConsumerWithFlakeUrl(
        tmp,
        "real-remote-consumer",
        realRemoteRef,
        $,
      );
      const expected = expectedRealRemoteRequestedRef(realRemoteRef);
      const sourcePath = await activateAndAssertStatus(consumer, expected);

      await runBareCommands(consumer, consumer);
      await assertCleanConsumerBoundary(consumer, sourcePath);
      await runBareCommands(consumer, path.join(consumer, "projects"));
      await assertCleanConsumerBoundary(consumer, sourcePath);
    });
  },
);

test("remote consumers activate locked source, run bare commands, and keep ownership boundaries", async () => {
  await runInScratchTemp("viberoots-remote-consumer", async (tmp, $) => {
    const source = await makeRemoteSource(tmp, $);
    const first = await makeConsumer(tmp, "consumer-a", source, $);
    const second = await makeConsumer(tmp, "consumer-b", source, $);

    for (const consumer of [first, second]) {
      const sourcePath = await activateAndAssertStatus(consumer);
      const visible = (await fsp.readdir(consumer)).filter((name) => !name.startsWith(".")).sort();
      assert.deepEqual(visible, ["README.md", "projects"]);
      assert.equal(await fsp.readlink(path.join(consumer, ".viberoots/workspace/buck")), "../buck");

      await runBareCommands(consumer, consumer);
      await assertCleanConsumerBoundary(consumer, sourcePath);

      await runBareCommands(consumer, path.join(consumer, "projects"));
      await assertCleanConsumerBoundary(consumer, sourcePath);

      await $({ cwd: consumer, stdio: "pipe" })`buck2 targets //projects/...`;
      const appLabel = await $({
        cwd: consumer,
        stdio: "pipe",
      })`buck2 cquery //projects/apps/demo:smoke_script`;
      const providerLabel = await $({
        cwd: consumer,
        stdio: "pipe",
      })`buck2 cquery workspace_providers//:auto_map`;
      assert.match(String(appLabel.stdout), /root\/\/projects\/apps\/demo:smoke_script/);
      assert.match(String(providerLabel.stdout), /workspace_providers\/\/:auto_map/);
    }
  });
});
