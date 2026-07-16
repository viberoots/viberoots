#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { activateWorkspace } from "../../lib/workspace-activation";
import { remoteSourceStatus } from "../../lib/workspace-remote-source";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import {
  makeConsumer,
  makeConsumerWithFlakeUrl,
  makeRemoteSource,
  REPO_ROOT,
  TEMPLATE_ROOT,
} from "./remote-consumer-fixture-helpers";
import {
  assertCleanConsumerBoundary,
  commandEnv,
  escapeRegex,
  exists,
  expectedRealRemoteRequestedRef,
  FORBIDDEN_SOURCE_STATE,
  walkFiles,
} from "./remote-consumer-boundary";

const VIBEROOTS_COMMAND = path.join(REPO_ROOT, "build-tools", "tools", "dev", "viberoots.ts");

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
  const staleEnvSource = path.join(path.dirname(consumer), "stale-env-viberoots");
  await fsp.mkdir(staleEnvSource, { recursive: true });
  await fsp.writeFile(path.join(staleEnvSource, "flake.nix"), "{}\n");
  const activation = await activateWorkspace({
    start: consumer,
    env: { WORKSPACE_ROOT: consumer, VIBEROOTS_ROOT: staleEnvSource },
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

async function runBareCommands(consumer: string, cwd: string, sourcePath: string): Promise<void> {
  const env = commandEnv(consumer);
  await $({ cwd, env, stdio: "pipe" })`i --glue-only --skip-go-tidy`;
  await assertCleanConsumerBoundary(consumer, sourcePath, "after i");
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
  await assertCleanConsumerBoundary(consumer, sourcePath, "after b");
  await $({
    cwd,
    env,
    stdio: "pipe",
  })`v //projects/apps/demo:smoke_test`;
  await assertCleanConsumerBoundary(consumer, sourcePath, "after v");
  const status = await $({
    cwd,
    env: { ...env, VBR_TAIL_LOG_STATUS_INTERVAL: "1" },
    stdio: "pipe",
    nothrow: true,
  })`timeout 10s s`;
  const statusOutput = [status.stdout, status.stderr].map((part) => String(part || "")).join("\n");
  assert.match(
    statusOutput,
    /Runnable targets:|Waiting for filesystem changes|Buck processes:/,
    `expected s to render status before timeout, exit=${status.exitCode} stdout=${String(status.stdout)} stderr=${String(status.stderr)}`,
  );
  assert.equal(status.exitCode === 0 || status.exitCode === 124, true);
  await assertCleanConsumerBoundary(consumer, sourcePath, "after s");
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
  assert.notEqual(
    lock.nodes.viberoots.locked.narHash,
    "sha256-0000000000000000000000000000000000000000000=",
  );
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

      await runBareCommands(consumer, consumer, sourcePath);
      await assertCleanConsumerBoundary(consumer, sourcePath);
      await runBareCommands(consumer, path.join(consumer, "projects"), sourcePath);
      await assertCleanConsumerBoundary(consumer, sourcePath);
    });
  },
);

test("consumer boundary check rejects representative parent-owned source state", async () => {
  await runInScratchTemp("viberoots-consumer-boundary-negative", async (tmp) => {
    const consumer = path.join(tmp, "consumer");
    const source = path.join(tmp, "source");
    await fsp.mkdir(path.join(consumer, ".viberoots/workspace/providers"), { recursive: true });
    await fsp.mkdir(path.join(consumer, ".viberoots/workspace/buck"), { recursive: true });
    await fsp.mkdir(path.join(consumer, "projects"), { recursive: true });
    await fsp.writeFile(path.join(consumer, "projects/node-modules.hashes.json"), "{}\n");
    await fsp.mkdir(source, { recursive: true });

    for (const rel of FORBIDDEN_SOURCE_STATE) {
      const target = path.join(source, rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, "misplaced\n");
      await assert.rejects(
        assertCleanConsumerBoundary(consumer, source, `negative ${rel}`),
        new RegExp(escapeRegex(`unexpected source ${rel}`)),
      );
      await fsp.rm(path.join(source, rel.split("/")[0]), { recursive: true, force: true });
    }
  });
});

test("reusable deployment docs keep parent-specific families out of viberoots examples", async () => {
  const docsRoot = path.join(REPO_ROOT, "docs");
  const reusableDocs = (await walkFiles(docsRoot))
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.relative(REPO_ROOT, file))
    .filter((rel) => !rel.startsWith(`docs${path.sep}history${path.sep}`))
    .filter((rel) => rel !== path.join("docs", "viberoots-flake-plan.md"));
  for (const rel of ["README.md", ...reusableDocs]) {
    const text = await fsp.readFile(path.join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(text, /\b[Pp]leomino\b/);
    assert.doesNotMatch(text, /\bSAMPLE_WEBAPP_/);
  }
});

test("reusable deployment bootstrap runtime keeps parent-specific families out of primary source", async () => {
  const sourceRoot = path.join(REPO_ROOT, "build-tools", "tools", "deployments");
  const reusableSources = (await walkFiles(sourceRoot))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.relative(REPO_ROOT, file));
  for (const rel of reusableSources) {
    const text = await fsp.readFile(path.join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(text, /\b[Pp]leomino\b/, rel);
    assert.doesNotMatch(text, /\bSAMPLE_WEBAPP_/, rel);
  }
});

test("remote consumers activate locked source, run bare commands, and keep ownership boundaries", async () => {
  await runInScratchTemp("viberoots-remote-consumer", async (tmp, $) => {
    const source = await makeRemoteSource(tmp, $);
    const first = await makeConsumer(tmp, "consumer-a", source, $);
    const second = await makeConsumer(tmp, "consumer-b", source, $);

    try {
      for (const consumer of [first, second]) {
        const sourcePath = await activateAndAssertStatus(consumer);
        const visible = (await fsp.readdir(consumer))
          .filter((name) => !name.startsWith("."))
          .sort();
        assert.deepEqual(visible, ["README.md", "projects"]);
        assert.equal(
          await fsp.readlink(path.join(consumer, ".viberoots/workspace/buck")),
          "../buck",
        );

        await runBareCommands(consumer, consumer, sourcePath);
        await assertCleanConsumerBoundary(consumer, sourcePath);

        await runBareCommands(consumer, path.join(consumer, "projects"), sourcePath);
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
    } finally {
      await killBuckDaemonsForRepo(tmp, $);
    }
  });
});
