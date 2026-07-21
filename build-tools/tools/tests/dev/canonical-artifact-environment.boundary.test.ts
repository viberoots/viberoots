#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  artifactSelectorNames,
  assertNoArtifactSelectorInjection,
  buildArtifactEnvironment,
  canonicalArtifactToolsRoot,
  isArtifactAffectingEnvName,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("canonical artifact environments isolate state and bypass hostile host tools and selectors", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-env-"));
  try {
    const storeBin = String(process.env.PATH || "")
      .split(path.delimiter)
      .find((entry) => entry.startsWith("/nix/store/"));
    assert.ok(storeBin, "test requires one Nix-store PATH entry");
    const env = buildArtifactEnvironment({
      baseEnv: {
        PATH: `/host/bin${path.delimiter}${storeBin}`,
        HOME: "/host/home",
        XDG_CONFIG_HOME: "/host/config",
        VBR_NIX_BIN: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-unreviewed/bin/nix",
      },
      mode: "local",
      stateRoot: tmp,
      workspaceRoot: process.cwd(),
    });
    assert.equal(env.PATH, path.join(canonicalArtifactToolsRoot(process.cwd()), "bin"));
    assert.match(
      String(env.VBR_NIX_BIN),
      /^\/nix\/(?:store\/|var\/nix\/profiles\/default\/bin\/nix)/,
    );
    assert.notEqual(
      env.VBR_NIX_BIN,
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-unreviewed/bin/nix",
    );
    assert.equal(env.HOME, path.join(tmp, "home"));
    assert.equal(env.LANG, "C.UTF-8");
    assert.equal(env.TZ, "UTC");
    assert.equal(env.CC, undefined);
    assert.equal(env.PYTHONPATH, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.doesNotThrow(() =>
      assertNoArtifactSelectorInjection(env, { allow: ["VBR_ARTIFACT_TOOLS_ROOT"] }),
    );
    assert.equal(env.VBR_FILTERED_FLAKE_SNAPSHOT, undefined);
    const nestedEnv = buildArtifactEnvironment({
      baseEnv: { VBR_ARTIFACT_TOOLS_ROOT: String(env.VBR_ARTIFACT_TOOLS_ROOT) },
      mode: "local",
      stateRoot: path.join(tmp, "nested"),
      workspaceRoot: process.cwd(),
    });
    assert.equal(nestedEnv.VBR_ARTIFACT_TOOLS_ROOT, env.VBR_ARTIFACT_TOOLS_ROOT);
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: { VBR_FILTERED_FLAKE_SNAPSHOT: "1" },
          mode: "local",
          stateRoot: path.join(tmp, "ambient-selector"),
          workspaceRoot: process.cwd(),
        }),
      /rejects ambient selectors/,
    );
    const explicitSelectorEnv = buildArtifactEnvironment({
      baseEnv: {},
      mode: "local",
      stateRoot: path.join(tmp, "explicit"),
      workspaceRoot: process.cwd(),
      internal: {
        VBR_FILTERED_FLAKE_SNAPSHOT: "1",
        VBR_PNPM_FILTERED_SNAPSHOT_ROOT: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
      },
    });
    assert.equal(explicitSelectorEnv.VBR_FILTERED_FLAKE_SNAPSHOT, "1");
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: {},
          mode: "local",
          stateRoot: path.join(tmp, "reserved-internal"),
          workspaceRoot: process.cwd(),
          internal: { HOME: "/host/home", PATH: "/host/bin" },
        }),
      /cannot override canonical keys: HOME, PATH/,
    );
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: {
            VBR_ARTIFACT_TOOLS_ROOT: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-stale-tools",
          },
          mode: "local",
          stateRoot: tmp,
          workspaceRoot: process.cwd(),
        }),
      /active artifact tool authority/,
    );
    const mutableTools = path.join(tmp, "mutable-tools");
    await fsp.symlink(canonicalArtifactToolsRoot(process.cwd()), mutableTools);
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: {},
          mode: "local",
          stateRoot: path.join(tmp, "mutable-state"),
          workspaceRoot: process.cwd(),
          artifactToolsRoot: mutableTools,
        }),
      /must be a literal Nix store directory/,
    );
    for (const rel of ["home", "tmp", "xdg-cache", "xdg-config", "xdg-data"]) {
      assert.equal((await fsp.stat(path.join(tmp, rel))).isDirectory(), true);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("known artifact selector injection fails with bundle remediation", () => {
  assert.throws(
    () => assertNoArtifactSelectorInjection({ BUCK_TARGET: "//private:target" }),
    /remove them and declare the values in the evaluation bundle/,
  );
  assert.throws(
    () =>
      assertNoArtifactSelectorInjection({
        CC: "/usr/bin/cc",
        GCC: "/usr/bin/gcc",
        RUSTC: "/usr/bin/rustc",
        NODE: "/usr/bin/node",
        NODE_OPTIONS: "--require /host/hook.js",
        PYTHONPATH: "/opt/python",
        VBR_ARTIFACT_TOOLS_ROOT: "/tmp/tools",
        VBR_FILTERED_FLAKE_SNAPSHOT: "1",
        VBR_PNPM_FILTERED_SNAPSHOT_ROOT: "/tmp/source",
        VIBEROOTS_ROOT: "/tmp/viberoots",
      }),
    /CC, GCC, NODE, NODE_OPTIONS, PYTHONPATH, RUSTC, VBR_ARTIFACT_TOOLS_ROOT, VBR_FILTERED_FLAKE_SNAPSHOT, VBR_PNPM_FILTERED_SNAPSHOT_ROOT, VIBEROOTS_ROOT/,
  );
  assert.throws(
    () =>
      assertNoArtifactSelectorInjection({
        CC: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-clang/bin/cc",
        PYTHONPATH: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-python/site-packages",
      }),
    /CC, PYTHONPATH/,
  );
  assert.throws(() => assertNoArtifactSelectorInjection({ RUSTFLAGS: "-C target-cpu=native" }));
  assert.ok(artifactSelectorNames().includes("PYTHONPATH"));
});

test("explicit tool authority is stable after ambient environment mutation", () => {
  const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const previous = process.env.VBR_ARTIFACT_TOOLS_ROOT;
  try {
    process.env.VBR_ARTIFACT_TOOLS_ROOT = "/tmp/host-mutated-tools";
    const env = buildArtifactEnvironment({
      baseEnv: withoutArtifactEnvironmentInfluence(process.env),
      mode: "local",
      stateRoot: path.join(os.tmpdir(), `artifact-authority-${process.pid}`),
      workspaceRoot: process.cwd(),
      artifactToolsRoot: toolsRoot,
    });
    assert.equal(env.VBR_ARTIFACT_TOOLS_ROOT, toolsRoot);
  } finally {
    if (previous === undefined) delete process.env.VBR_ARTIFACT_TOOLS_ROOT;
    else process.env.VBR_ARTIFACT_TOOLS_ROOT = previous;
  }
});

test("CI rejects unreviewed artifact namespaces but strips harmless metadata", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-ci-env-"));
  try {
    for (const name of [
      "NIX_CONFIG",
      "COREPACK_HOME",
      "PIP_CONFIG_FILE",
      "GOTOOLCHAIN",
      "CMAKE_TOOLCHAIN_FILE",
      "MAKEFLAGS",
    ]) {
      assert.equal(isArtifactAffectingEnvName(name), true);
      assert.throws(
        () =>
          buildArtifactEnvironment({
            baseEnv: { [name]: "host-value" },
            mode: "ci",
            stateRoot: tmp,
            workspaceRoot: process.cwd(),
          }),
        new RegExp(`CI artifact build rejects unreviewed artifact environment: ${name}`),
      );
    }
    const env = buildArtifactEnvironment({
      baseEnv: { CI: "1", GITHUB_RUN_ID: "123", RUNNER_NAME: "host-runner" },
      mode: "ci",
      stateRoot: tmp,
      workspaceRoot: process.cwd(),
      internal: { BUCK_TARGET: "//:declared" },
    });
    assert.equal(env.CI, "1");
    assert.equal(env.GITHUB_RUN_ID, undefined);
    assert.equal(env.RUNNER_NAME, undefined);
    assert.equal(env.BUCK_TARGET, "//:declared");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("selected builds reject ambient graph selectors before exporting a graph", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      viberootsSourcePath("build-tools/tools/dev/zx-init.mjs"),
      viberootsSourcePath("build-tools/tools/dev/build-selected.ts"),
      "--source=git",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...withoutArtifactEnvironmentInfluence(process.env),
        NODE_OPTIONS: "",
        BUCK_TARGET: "//:ambient-selector-canary",
        BUCK_QUERY_ROOTS: "host-only-root",
        BUCK_TARGET_ATTR: "host_attr",
        BUCK_TARGET_PLATFORM: "host-platform",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    String(result.stderr || ""),
    /artifact build rejects ambient selectors: BUCK_QUERY_ROOTS, BUCK_TARGET, BUCK_TARGET_ATTR, BUCK_TARGET_PLATFORM/,
  );
  assert.doesNotMatch(String(result.stderr || ""), /exporting graph/);
});
