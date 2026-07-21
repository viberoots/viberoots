#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  writeDemoGraph,
  writeRunnableFixture,
} from "./runnable-commands.package-label-resolution.fixture";

const fixtureRunner = viberootsSourcePath("build-tools/tools/tests/dev/run-runnable.fixture.ts");

function fixtureEnv(): NodeJS.ProcessEnv {
  return withoutArtifactEnvironmentInfluence(process.env);
}

test("p resolves package label to runnable target label", async () => {
  await runInTemp("runnable-package-label-resolution", async (tmp, $) => {
    await writeDemoGraph(tmp);
    const manifestPath = await writeRunnableFixture(tmp, "package-resolution-ok");

    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: fixtureEnv(),
    })`zx-wrapper ${fixtureRunner} --mode prod //projects/apps/demo --fixture-manifest=${manifestPath}`;
    assert.match(String(run.stdout || ""), /package-resolution-ok/);
  });
});

test("p resolves relative and absolute directory paths to runnable target label", async () => {
  await runInTemp("runnable-path-label-resolution", async (tmp, $) => {
    await writeDemoGraph(tmp);
    const manifestPath = await writeRunnableFixture(tmp, "path-resolution-ok");
    const commonEnv = fixtureEnv();

    const relativeRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`zx-wrapper ${fixtureRunner} --mode prod projects/apps/demo --fixture-manifest=${manifestPath}`;
    assert.match(String(relativeRun.stdout || ""), /path-resolution-ok/);

    const absoluteRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`zx-wrapper ${fixtureRunner} --mode prod ${path.join(tmp, "projects", "apps", "demo")} --fixture-manifest=${manifestPath}`;
    assert.match(String(absoluteRun.stdout || ""), /path-resolution-ok/);
  });
});

for (const scenario of [
  {
    name: "d resolves current directory path (.) from package cwd",
    tempName: "runnable-dot-cwd-resolution",
    buildOutput: "dot-resolution-ok",
    devOutput: "dev-dot-ok",
    argument: ".",
  },
  {
    name: "d defaults to current directory when target is omitted",
    tempName: "runnable-default-cwd-resolution",
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
      const manifestPath = await writeRunnableFixture(
        tmp,
        scenario.buildOutput,
        scenario.devOutput,
      );
      const env = fixtureEnv();
      const run = scenario.argument
        ? await $({
            cwd: appDir,
            stdio: "pipe",
            env,
          })`zx-wrapper ${fixtureRunner} --mode dev ${scenario.argument} --fixture-manifest=${manifestPath}`
        : await $({
            cwd: appDir,
            stdio: "pipe",
            env,
          })`zx-wrapper ${fixtureRunner} --mode dev --fixture-manifest=${manifestPath}`;
      assert.match(String(run.stdout || ""), new RegExp(scenario.devOutput));
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
    const manifestPath = await writeRunnableFixture(tmp, "stale-graph-fallback-ok");

    const run = await $({
      cwd: appDir,
      stdio: "pipe",
      env: fixtureEnv(),
    })`zx-wrapper ${fixtureRunner} --mode prod . --fixture-manifest=${manifestPath}`;
    assert.match(String(run.stdout || ""), /stale-graph-fallback-ok/);
  });
});
