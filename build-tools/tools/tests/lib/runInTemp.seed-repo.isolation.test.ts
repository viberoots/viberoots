#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp seed repo does not leak mutations across temp repos", async () => {
  assert.ok(
    process.env.VBR_TEST_SEED_STORE_PATH,
    "expected verifier to provide VBR_TEST_SEED_STORE_PATH",
  );

  const realRepoRoot = process.cwd();
  const targetRel = path.join(".viberoots", "workspace", "flake.nix");
  const realPath = path.join(realRepoRoot, targetRel);
  const original = await fsp.readFile(realPath, "utf8");
  await runInTemp("seed-isolation-1", async (tmp) => {
    const p = path.join(tmp, targetRel);
    await fsp.access(p, fs.constants.W_OK);
    await fsp.appendFile(p, "\nseed-isolation-test: mutated\n", "utf8");
  });

  await runInTemp("seed-isolation-2", async (tmp, _$) => {
    assert.ok(
      process.env.VIBEROOTS_FLAKE_INPUT_ROOT,
      "expected runInTemp to provide VIBEROOTS_FLAKE_INPUT_ROOT",
    );
    const expectedInputRoot = await fsp.realpath(process.env.VIBEROOTS_FLAKE_INPUT_ROOT);
    assert.match(expectedInputRoot, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    const p = path.join(tmp, targetRel);
    const now = await fsp.readFile(p, "utf8");
    const activeSourceRoot =
      process.env.VIBEROOTS_SOURCE_ROOT || path.join(realRepoRoot, "viberoots");
    const sourceModulesPath = path.join(
      activeSourceRoot,
      "build-tools",
      "tools",
      "nix",
      "node-modules",
      "modules.nix",
    );
    const tempModulesRel = path.join(
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "node-modules",
      "modules.nix",
    );
    const sourceModules = await fsp.readFile(sourceModulesPath, "utf8");
    const tempHeadModules = await _$({
      cwd: tmp,
      stdio: "pipe",
    })`git show ${`HEAD:${tempModulesRel}`}`;
    const inputMatch = now.match(/viberoots\.url = "path:([^"]+)"/);
    assert.ok(inputMatch, "expected temp repo workspace flake to declare viberoots input");
    const immutableInputRoot = inputMatch[1];
    assert.equal(
      immutableInputRoot,
      expectedInputRoot,
      "expected temp repo workspace flake to point at the canonical immutable viberoots source",
    );
    assert.ok(
      !now.includes(`viberoots.url = "path:${path.join(realRepoRoot, "viberoots")}"`),
      "expected temp repo workspace flake not to point at the live checkout source",
    );
    assert.ok(
      !now.includes("seed-isolation-test: mutated"),
      "expected second temp repo to start from a clean seed (no mutation leakage)",
    );
    assert.equal(
      String(tempHeadModules.stdout || ""),
      sourceModules,
      "expected seeded temp repo git HEAD to include the active viberoots source overlay",
    );
    assert.ok(original.includes('viberoots.url = "path:'), "expected original workspace flake");
  });
});
