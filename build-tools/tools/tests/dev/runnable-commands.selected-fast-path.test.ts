#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";
import {
  prepareSelectedFastPathFixture,
  selectedFastPathTarget,
} from "./runnable-commands.selected-fast-path.fixture";

test("p uses graph-generator-selected and skips full graph-generator for runnable target", async () => {
  await runInTemp("runnable-selected-fast-path", async (tmp, $) => {
    await prepareSelectedFastPathFixture(tmp);
    await $`u`;
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: withoutArtifactEnvironmentInfluence(process.env),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.match(
      String(run.stderr || ""),
      /creating filtered source snapshot/i,
      "pure selected builds must capture their source before evaluation",
    );

    const logTxt = String(run.stderr || "");
    assert.doesNotMatch(logTxt, /build runnable manifest/);
    assert.doesNotMatch(logTxt, /(^|\s)graph-generator(\s|$)/);
  });
});

test("p auto source falls back to path flake for relevant untracked files", async () => {
  await runInTemp("runnable-selected-auto-source", async (tmp, $) => {
    await prepareSelectedFastPathFixture(tmp, {
      withProjectFiles: true,
      withPackageJson: true,
    });
    await $`u`;
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: withoutArtifactEnvironmentInfluence(process.env),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.match(String(run.stderr || ""), /creating filtered source snapshot/i);
  });
});

test("p keeps temp workspaces on path capture even with --source=git", async () => {
  await runInTemp("runnable-selected-git-source", async (tmp, $) => {
    await prepareSelectedFastPathFixture(tmp, {
      withProjectFiles: true,
    });
    await $`u`;
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: withoutArtifactEnvironmentInfluence(process.env),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget} --source=git`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.match(String(run.stderr || ""), /creating filtered source snapshot/i);
  });
});
