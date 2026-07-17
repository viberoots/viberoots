#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { envWithStubbedNix, runInTemp } from "../lib/test-helpers";
import {
  selectedTargets,
  writeDemoGraph,
  writePnpmCwdStub,
  writeSelectedNixStub,
} from "./runnable-commands.package-label-resolution.fixture";

test("p resolves package label to runnable target label", async () => {
  await runInTemp("runnable-package-label-resolution", async (tmp, $) => {
    await writeDemoGraph(tmp);
    const targetLog = path.join(tmp, "buck-target.log");
    const stubBin = await writeSelectedNixStub(tmp, targetLog, "package-resolution-ok");

    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: envWithStubbedNix(stubBin),
    })`viberoots/build-tools/tools/bin/p //projects/apps/demo`;
    assert.match(String(run.stdout || ""), /package-resolution-ok/);
    assert.deepEqual(await selectedTargets(targetLog), ["//projects/apps/demo:app"]);
  });
});

test("p resolves relative and absolute directory paths to runnable target label", async () => {
  await runInTemp("runnable-path-label-resolution", async (tmp, $) => {
    await writeDemoGraph(tmp);
    const targetLog = path.join(tmp, "buck-target.log");
    const stubBin = await writeSelectedNixStub(tmp, targetLog, "path-resolution-ok");
    const commonEnv = envWithStubbedNix(stubBin);

    const relativeRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`viberoots/build-tools/tools/bin/p projects/apps/demo`;
    assert.match(String(relativeRun.stdout || ""), /path-resolution-ok/);

    const absoluteRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`viberoots/build-tools/tools/bin/p ${path.join(tmp, "projects", "apps", "demo")}`;
    assert.match(String(absoluteRun.stdout || ""), /path-resolution-ok/);
    assert.deepEqual(await selectedTargets(targetLog), [
      "//projects/apps/demo:app",
      "//projects/apps/demo:app",
    ]);
  });
});

for (const scenario of [
  {
    name: "d resolves current directory path (.) from package cwd",
    tempName: "runnable-dot-cwd-resolution",
    targetLog: "buck-target-dot.log",
    buildOutput: "dot-resolution-ok",
    devOutput: "dev-dot-ok",
    argument: ".",
  },
  {
    name: "d defaults to current directory when target is omitted",
    tempName: "runnable-default-cwd-resolution",
    targetLog: "buck-target-default.log",
    buildOutput: "default-resolution-build-ok",
    devOutput: "dev-default-ok",
    argument: undefined,
  },
] as const) {
  test(scenario.name, async () => {
    await runInTemp(scenario.tempName, async (tmp, $) => {
      await writeDemoGraph(tmp);
      const appDir = path.join(tmp, "projects", "apps", "demo");
      await fsp.mkdir(appDir, { recursive: true });
      const targetLog = path.join(tmp, scenario.targetLog);
      const stubBin = await writeSelectedNixStub(tmp, targetLog, scenario.buildOutput);
      await writePnpmCwdStub(tmp, stubBin, scenario.devOutput);
      const command = path.join(tmp, "viberoots", "build-tools", "tools", "bin", "d");
      const run = scenario.argument
        ? await $({
            cwd: appDir,
            stdio: "pipe",
            env: envWithStubbedNix(stubBin),
          })`${command} ${scenario.argument}`
        : await $({ cwd: appDir, stdio: "pipe", env: envWithStubbedNix(stubBin) })`${command}`;
      assert.match(String(run.stdout || ""), new RegExp(scenario.devOutput));
      assert.deepEqual(await selectedTargets(targetLog), ["//projects/apps/demo:app"]);
    });
  });
}

test("p falls back from a directory path to :app when graph data is stale", async () => {
  await runInTemp("runnable-stale-graph-app-fallback", async (tmp, $) => {
    await writeDemoGraph(tmp, []);
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "smoke.sh"), "#!/usr/bin/env bash\necho smoke\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "export_file")',
        "",
        "export_file(",
        '    name = "app",',
        '    src = "smoke.sh",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    const targetLog = path.join(tmp, "buck-target-stale.log");
    const stubBin = await writeSelectedNixStub(tmp, targetLog, "stale-graph-fallback-ok");

    const run = await $({
      cwd: appDir,
      stdio: "pipe",
      env: envWithStubbedNix(stubBin),
    })`${path.join(tmp, "viberoots", "build-tools", "tools", "bin", "p")} .`;
    assert.match(String(run.stdout || ""), /stale-graph-fallback-ok/);
    assert.deepEqual(await selectedTargets(targetLog), ["//projects/apps/demo:app"]);
  });
});
