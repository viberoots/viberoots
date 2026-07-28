#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnVerifyBuck2Tests } from "../../dev/verify/buck2-test";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

test("spawnVerifyBuck2Tests captures a child close before wait begins", async () => {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.pid = 12345;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const spawned = spawnVerifyBuck2Tests({
    root: fs.mkdtempSync(path.join(os.tmpdir(), "vbr-fast-buck-close-")),
    iso: "v-fast-close",
    logFile: null,
    console: "simple",
    targets: ["//:target"],
    zxNodeModulesOut: null,
    threadsOverride: 1,
    passName: "shared",
    executionPolicy: parseVerifyExecutionPolicy({ env: {} }),
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
    spawnImpl: (() => {
      queueMicrotask(() => {
        proc.emit("exit", 0, null);
        proc.emit("close", 0, null);
      });
      return proc;
    }) as typeof spawn,
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  const timeout = new Promise<number>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("wait missed the child close event")), 1_000);
    timer.unref();
  });
  assert.equal(await Promise.race([spawned.wait(), timeout]), 0);
});
