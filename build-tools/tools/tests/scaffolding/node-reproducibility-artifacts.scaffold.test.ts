#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Node reproducibility scaffolds emit source-built artifacts", async () => {
  await runInTemp("node-reproducibility-scaffolds", async (tmp, inherited) => {
    const $ = inherited({ cwd: tmp, stdio: "pipe" });
    await $`scaf new ts lib repro-node --yes --skip-lockfile-gen`;
    await $`scaf new ts go-cpp-lib repro-mixed --yes --path=projects --skip-lockfile-gen`;

    const standaloneRoot = path.join(tmp, "projects/libs/repro-node");
    const mixedRoot = path.join(tmp, "projects/libs/repro-mixed-ts");
    const standaloneTargets = await fs.readFile(path.join(standaloneRoot, "TARGETS"), "utf8");
    const mixedTargets = await fs.readFile(path.join(mixedRoot, "TARGETS"), "utf8");
    const standaloneBuilder = await fs.readFile(path.join(standaloneRoot, "build.mjs"), "utf8");
    const mixedBuilder = await fs.readFile(path.join(mixedRoot, "build.mjs"), "utf8");

    assert.match(standaloneTargets, /\$VBR_NODE_BIN build\.mjs src\/index\.ts \$OUT\/index\.mjs/);
    assert.match(standaloneTargets, /out = "dist"/);
    assert.match(standaloneBuilder, /stripTypeScriptTypes\(source/);
    assert.match(mixedTargets, /\$VBR_NODE_BIN build\.mjs src\/node\/index\.ts/);
    assert.match(mixedTargets, /\$\(location \/\/projects\/libs\/repro-mixed-native:napi_addon\)/);
    assert.match(mixedBuilder, /copyFile\(addonPath, addonOutput\)/);
    assert.match(mixedBuilder, /stripTypeScriptTypes\(source/);
    assert.doesNotMatch(`${standaloneTargets}\n${mixedTargets}`, /build\.stamp|echo ok/);
  });
});
