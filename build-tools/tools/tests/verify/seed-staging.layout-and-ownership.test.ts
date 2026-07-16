#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createSharedSeedStagePin,
  seedStageRootDirForTest,
  stageSeedStore,
} from "../../dev/verify/seed-staging";
import { mktemp } from "../lib/test-helpers";
import {
  initGitSeed,
  readRepoFile,
  withSeedStageRoot,
  writeRequiredStageFiles,
} from "./seed-staging-fixture";

test("verify seed staging stays outside volatile verify TMPDIR", () => {
  const root = seedStageRootDirForTest();
  if (process.platform === "win32") {
    assert.equal(root, path.join(os.tmpdir(), "viberoots-test-seed"));
    return;
  }
  if (process.platform === "darwin") {
    assert.ok(root.startsWith("/tmp/viberoots-test-seed"));
    assert.ok(root.includes(".noindex"));
    assert.ok(root.endsWith(path.join(".noindex", "stage-v8")));
    assert.ok(!root.includes("/viberoots-verify"));
    return;
  }
  assert.ok(root.startsWith("/tmp/viberoots-test-seed"));
  assert.ok(root.endsWith("stage-v8"));
  assert.ok(!root.includes("/viberoots-verify"));
});

test("verify seed staging uses a protocol-versioned shared root", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed-stage-layout.ts");
  assert.match(source, /STAGE_ROOT_PROTOCOL_DIR = "stage-v8"/);
  assert.match(source, /return path\.join\(base, STAGE_ROOT_PROTOCOL_DIR\)/);
});

test("verify seed staging prunes stale shared stage directories", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  const staleStage = path.join(stageRoot, "seed-stale");
  const staleLock = path.join(stageRoot, "lock-stale");
  await fsp.mkdir(staleStage, { recursive: true });
  await fsp.writeFile(path.join(staleStage, "old.txt"), "old\n", "utf8");
  await fsp.mkdir(staleLock, { recursive: true });
  await fsp.writeFile(
    path.join(staleLock, "owner.json"),
    JSON.stringify({ pid: 999_999, startedAt: "1970-01-01T00:00:00.000Z" }) + "\n",
    "utf8",
  );
  await withSeedStageRoot(stageRoot, async () => {
    await stageSeedStore(seed, `seed-stage-prune-${process.pid}-${Date.now()}`, 86_400_000);
  });
  await assert.rejects(fsp.access(staleStage));
  await assert.rejects(fsp.access(staleLock));
});

test("verify seed staging preserves stages pinned by live verify runs", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const workspaceRoot = await mktemp("seed-stage-workspace-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  await initGitSeed(seed);
  const staleStage = path.join(stageRoot, "seed-live-pinned");
  await fsp.mkdir(staleStage, { recursive: true });
  await fsp.writeFile(path.join(staleStage, "old.txt"), "old\n", "utf8");
  const pinDir = path.join(
    workspaceRoot,
    ".viberoots",
    "workspace",
    "buck",
    "verify-seed",
    "pins",
    "live",
  );
  await fsp.mkdir(pinDir, { recursive: true });
  await fsp.writeFile(
    path.join(pinDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
  await fsp.symlink(staleStage, path.join(pinDir, "seed"));
  await withSeedStageRoot(stageRoot, async () => {
    await stageSeedStore(seed, `seed-stage-prune-${process.pid}-${Date.now()}`, 86_400_000, {
      workspaceRoot,
    });
  });
  await fsp.access(staleStage);
});

test("verify seed staging preserves stages pinned through shared pins", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  const pinnedStage = path.join(stageRoot, "seed-live-shared-pinned");
  await fsp.mkdir(pinnedStage, { recursive: true });
  await fsp.writeFile(path.join(pinnedStage, "old.txt"), "old\n", "utf8");
  await withSeedStageRoot(stageRoot, async () => {
    assert.ok(await createSharedSeedStagePin(pinnedStage, "other-workspace-run"));
    await stageSeedStore(seed, `seed-stage-prune-${process.pid}-${Date.now()}`, 86_400_000);
  });
  await fsp.access(pinnedStage);
});

test("verify seed staging prunes fresh unpinned dirty-state stages", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  const previousStage = path.join(stageRoot, "seed-previous");
  await fsp.mkdir(previousStage, { recursive: true });
  await fsp.writeFile(path.join(previousStage, "old.txt"), "old\n", "utf8");
  await withSeedStageRoot(stageRoot, async () => {
    await stageSeedStore(seed, `seed-stage-prune-${process.pid}-${Date.now()}`, 86_400_000);
  });
  await assert.rejects(fsp.access(previousStage));
});

test("verify seed staging preserves fresh stages with live locks", async () => {
  const stageRoot = await mktemp("seed-stage-root-");
  const seed = await mktemp("seed-stage-prune-source-");
  await writeRequiredStageFiles(seed);
  const hash = "live123";
  const lockedStage = path.join(stageRoot, `seed-${hash}`);
  const lockDir = path.join(stageRoot, `lock-${hash}`);
  await fsp.mkdir(lockedStage, { recursive: true });
  await fsp.writeFile(path.join(lockedStage, "old.txt"), "old\n", "utf8");
  await fsp.mkdir(lockDir, { recursive: true });
  await fsp.writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
  await withSeedStageRoot(stageRoot, async () => {
    await stageSeedStore(seed, `seed-stage-prune-${process.pid}-${Date.now()}`, 86_400_000);
  });
  await fsp.access(lockedStage);
});
