#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { remoteSourceStatus } from "../../lib/workspace-remote-source";
import {
  lock,
  VALID_NAR_HASH,
  withWorkspace,
  writeLock,
} from "./workspace-lock-repair.test-helpers";

test("remote source status skips Nix evaluation for a matching immutable input", async () => {
  await withWorkspace("vbr-immutable-source-status", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"6".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
    );
    const current = lock(workspace, VALID_NAR_HASH);
    current.nodes.viberoots.locked.path = immutableInput;
    current.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);

    const status = remoteSourceStatus(workspace, {
      immutableSourceAccessible: () => true,
      execFileSync: (() => {
        throw new Error("Nix evaluation should not run for a matching immutable input");
      }) as typeof import("node:child_process").execFileSync,
    });

    assert.equal(status?.sourcePath, immutableInput);
    assert.equal(status?.requestedRef, immutableInput);
    assert.equal(status?.lockedRevision, VALID_NAR_HASH);
  });
});

test("remote source status evaluates malformed immutable authority", async () => {
  await withWorkspace("vbr-malformed-source-status", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"7".repeat(32)}-source`;
    const evaluatedInput = `/nix/store/${"8".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
    );
    const current = lock(workspace, "sha256-malformed");
    current.nodes.viberoots.locked.path = immutableInput;
    current.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);
    let evaluationCalls = 0;

    const status = remoteSourceStatus(workspace, {
      immutableSourceAccessible: () => true,
      execFileSync: (() => {
        evaluationCalls += 1;
        return evaluatedInput;
      }) as typeof import("node:child_process").execFileSync,
    });

    assert.equal(evaluationCalls, 1);
    assert.equal(status?.sourcePath, evaluatedInput);
  });
});
