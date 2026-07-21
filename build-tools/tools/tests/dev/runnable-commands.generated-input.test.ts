#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { ensureToolchainPathsForTempRepo } from "../lib/test-helpers/toolchain-paths";

test("filtered runnable source uses immutable input when root input is generated state", async () => {
  const repoRoot = process.cwd();
  const fakeRoot = path.join(
    repoRoot,
    "buck-out",
    `runnable-selected-generated-viberoots-input-${process.pid}-${Date.now()}`,
  );
  await fsp.rm(fakeRoot, { recursive: true, force: true }).catch(() => {});
  try {
    const target = "//projects/apps/demo:demo";
    const immutableInput = await prepareFilteredViberootsInput(viberootsSourcePath("."));
    const graphDir = path.join(fakeRoot, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(fakeRoot, "projects", "apps", "demo", "src"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(fakeRoot, "viberoots"), { recursive: true });
    await fsp.writeFile(
      path.join(fakeRoot, "flake.nix"),
      [
        "{",
        '  inputs.viberoots.url = "path:./.viberoots/workspace/viberoots-flake-input";',
        "  outputs = { self, viberoots, ... }: {};",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "viberoots", "flake.nix"),
      "{ outputs = { self, ... }: {}; }\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "flake.lock"),
      JSON.stringify(
        {
          nodes: {
            root: { inputs: { viberoots: "viberoots" } },
            viberoots: {
              locked: {
                path: "./.viberoots/workspace/viberoots-flake-input",
                type: "path",
              },
              original: {
                path: "./.viberoots/workspace/viberoots-flake-input",
                type: "path",
              },
              parent: [],
            },
          },
          root: "root",
          version: 7,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.symlink(
      immutableInput.storePath,
      path.join(fakeRoot, ".viberoots", "workspace", "viberoots-flake-input"),
    );
    await ensureBuckConfigForTempRepo(fakeRoot, $, {
      viberootsInputRoot: immutableInput.storePath,
    });
    await ensureToolchainPathsForTempRepo(fakeRoot, $);
    await $({ cwd: fakeRoot, stdio: "pipe" })`git init`;
    await fsp.writeFile(
      path.join(fakeRoot, "projects", "apps", "demo", "src", "index.ts"),
      "console.log('ok');\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "projects", "apps", "demo", "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "genrule(",
        '    name = "demo",',
        '    out = "demo",',
        '    cmd = "touch $OUT",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_cli_bin",
            labels: ["lang:node", "kind:bin"],
            srcs: ["projects/apps/demo/src/index.ts"],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const artifactToolsRoot = canonicalArtifactToolsRoot(fakeRoot);
    const artifactEnv = buildArtifactEnvironment({
      baseEnv: withoutArtifactEnvironmentInfluence(process.env),
      mode: "local",
      stateRoot: path.join(fakeRoot, "buck-out", "tmp", "artifact-environment"),
      workspaceRoot: fakeRoot,
      artifactToolsRoot,
    });
    const source = await makeFilteredFlakeRef({
      workspaceRoot: fakeRoot,
      target,
      attr: "graph-generator-selected",
      logPrefix: "[runnable-generated-input]",
      classification: "local-development",
      env: artifactEnv,
      selectorEnv: {},
      immutableViberootsInputRoot: immutableInput.storePath,
    });
    assert.match(
      source.flakeRef,
      /^path:\/nix\/store\/[a-z0-9]{32}-viberoots-evaluation-bundle\?dir=source\/\.viberoots\/workspace#graph-generator-selected$/,
    );
    const bundlePath = source.flakeRef.slice("path:".length).split("?", 1)[0];
    const bundleLock = JSON.parse(
      await fsp.readFile(
        path.join(bundlePath, "source", ".viberoots", "workspace", "flake.lock"),
        "utf8",
      ),
    );
    const bundledInput = String(bundleLock.nodes?.viberoots?.locked?.path || "");
    assert.equal(bundledInput, immutableInput.storePath);
    assert.doesNotMatch(bundledInput, new RegExp(fakeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await source.cleanup?.();
  } finally {
    await fsp.rm(fakeRoot, { recursive: true, force: true }).catch(() => {});
  }
});
