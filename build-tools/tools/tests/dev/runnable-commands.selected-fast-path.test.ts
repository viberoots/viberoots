#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";
import {
  prepareSelectedFastPathFixture,
  selectedFastPathTarget,
} from "./runnable-commands.selected-fast-path.fixture";

test("p selected fast paths share one prepared consumer", async (context) => {
  await runInTemp("runnable-selected-fast-path", async (tmp, $) => {
    await prepareSelectedFastPathFixture(tmp, {
      withProjectFiles: true,
      withPackageJson: true,
    });
    await reconcileTempDependencyInputs(tmp, $);
    const runP = async (args: string[] = [], nothrow = false) =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        nothrow,
        env: withoutArtifactEnvironmentInfluence(process.env),
      })`${["viberoots/build-tools/tools/bin/p", selectedFastPathTarget, ...args]}`;

    await context.test("uses selected graph generation", async () => {
      const run = await runP();
      assert.match(String(run.stdout || ""), /selected-prod-ok/);
      const stderr = String(run.stderr || "");
      assert.match(stderr, /creating filtered source snapshot/i);
      assert.doesNotMatch(stderr, /build runnable manifest/);
      assert.doesNotMatch(stderr, /(^|\s)graph-generator(\s|$)/);
    });
    await context.test("auto source captures relevant untracked files", async () => {
      const run = await runP();
      assert.match(String(run.stdout || ""), /selected-prod-ok/);
      assert.match(String(run.stderr || ""), /creating filtered source snapshot/i);
    });
    await context.test("temp workspace keeps path capture for explicit git source", async () => {
      const run = await runP(["--source=git"]);
      assert.match(String(run.stdout || ""), /selected-prod-ok/);
      assert.match(String(run.stderr || ""), /creating filtered source snapshot/i);
    });
    await context.test("rejects test targets before output-shape inference", async () => {
      const targetsPath = path.join(tmp, "projects", "apps", "demo", "TARGETS");
      const targets = await fs.readFile(targetsPath, "utf8");
      await fs.writeFile(targetsPath, targets.replace('"kind:bin"', '"kind:test"'), "utf8");
      await reconcileTempDependencyInputs(tmp, $);
      const run = await runP([], true);
      assert.notEqual(run.exitCode, 0);
      assert.match(String(run.stderr || run.stdout), /target is not runnable \(test-only\)/);
      assert.doesNotMatch(String(run.stderr || ""), /creating filtered source snapshot/i);
    });
  });
});
