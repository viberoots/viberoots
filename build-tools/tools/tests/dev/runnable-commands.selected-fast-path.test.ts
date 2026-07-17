#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { envWithStubbedNix, runInTemp } from "../lib/test-helpers";
import {
  evaluationBundlePath,
  prepareSelectedFastPathFixture,
  selectedFastPathTarget,
} from "./runnable-commands.selected-fast-path.fixture";

test("p uses graph-generator-selected and skips full graph-generator for runnable target", async () => {
  await runInTemp("runnable-selected-fast-path", async (tmp, $) => {
    const { nixLog, stubBin } = await prepareSelectedFastPathFixture(tmp);
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: envWithStubbedNix(stubBin),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.match(
      String(run.stderr || ""),
      /creating filtered source snapshot/i,
      "pure selected builds must capture their source before evaluation",
    );

    const logTxt = await fsp.readFile(nixLog, "utf8");
    assert.match(logTxt, /graph-generator-selected/);
    assert.doesNotMatch(logTxt, /(^|\s)graph-generator(\s|$)/);
    evaluationBundlePath(logTxt);
  });
});

test("p auto source falls back to path flake for relevant untracked files", async () => {
  await runInTemp("runnable-selected-auto-source", async (tmp, $) => {
    const { nixLog, stubBin } = await prepareSelectedFastPathFixture(tmp, {
      withProjectFiles: true,
      withPackageJson: true,
    });
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: envWithStubbedNix(stubBin),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);

    const bundle = evaluationBundlePath(await fsp.readFile(nixLog, "utf8"));
    await fsp.access(path.join(bundle, "source", "projects", "apps", "demo", "NEW_UNTRACKED.txt"));
  });
});

test("p keeps temp workspaces on path capture even with --source=git", async () => {
  await runInTemp("runnable-selected-git-source", async (tmp, $) => {
    const { nixLog, stubBin } = await prepareSelectedFastPathFixture(tmp, {
      withProjectFiles: true,
    });
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: envWithStubbedNix(stubBin),
    })`viberoots/build-tools/tools/bin/p ${selectedFastPathTarget} --source=git`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);

    const bundle = evaluationBundlePath(await fsp.readFile(nixLog, "utf8"));
    await fsp.access(path.join(bundle, "source", "projects", "apps", "demo", "NEW_UNTRACKED.txt"));
  });
});
