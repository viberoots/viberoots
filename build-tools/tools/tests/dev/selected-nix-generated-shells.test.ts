#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function readSource(rel: string): Promise<string> {
  return await fsp.readFile(`viberoots/${rel}`, "utf8");
}

function generatedShellSource(source: string): string {
  return source.replace(/\\"/g, '"');
}

test("Buck-generated shell wrappers invoke the selected nix binary", async () => {
  const nixCacheHealth = await readSource("build-tools/lang/nix_cache_health.bzl");
  const nixShell = await readSource("build-tools/lang/nix_shell.bzl");
  const zxTest = await readSource("build-tools/tools/buck/zx_test.bzl");
  const buck2TestEnv = await readSource("build-tools/tools/dev/verify/buck2-test-env.ts");
  const nixCacheHealthShell = generatedShellSource(nixCacheHealth);
  const nixShellGenerated = generatedShellSource(nixShell);
  const zxTestGenerated = generatedShellSource(zxTest);

  if (!nixCacheHealthShell.includes('"$NIX_BIN" config show')) {
    throw new Error("nix cache health shell must read config through the selected nix binary");
  }
  if (!nixCacheHealthShell.includes('"$NIX_BIN" store info --store')) {
    throw new Error("nix cache health shell must probe caches through the selected nix binary");
  }
  if (!nixShellGenerated.includes('"$NIX_BIN" run --accept-flake-config')) {
    throw new Error("nix shell bootstrap must run helper tools through the selected nix binary");
  }
  if (
    !nixShellGenerated.includes('"$NIX_BIN" build %s --no-write-lock-file --accept-flake-config')
  ) {
    throw new Error("nix build helper must build through the selected nix binary");
  }
  if (!zxTestGenerated.includes('PRE_OUT=$("$NIX_BIN" build')) {
    throw new Error("zx_test prelude materialization must build through the selected nix binary");
  }
  if (!buck2TestEnv.includes("process.env.VBR_NIX_BIN || process.env.NIX_BIN")) {
    throw new Error("verify child env must prefer VBR_NIX_BIN before NIX_BIN");
  }
  if (buck2TestEnv.includes("path.dirname(nixBin)")) {
    throw new Error("verify child env must not depend on PATH for selected nix");
  }
  if (!buck2TestEnv.includes('maybeEnvArg("VBR_NIX_BIN", nixBin)')) {
    throw new Error("verify child env must export VBR_NIX_BIN");
  }
  if (!buck2TestEnv.includes('maybeEnvArg("NIX_BIN", nixBin)')) {
    throw new Error("verify child env must export NIX_BIN for compatibility");
  }
  if (buck2TestEnv.includes('maybeEnvArg("PATH"')) {
    throw new Error(
      "verify child env must pass selected tools explicitly instead of forwarding PATH",
    );
  }

  for (const [label, source] of [
    ["nix_cache_health.bzl", nixCacheHealth],
    ["nix_shell.bzl", nixShell],
    ["zx_test.bzl", zxTest],
  ] as const) {
    const raw = source
      .split("\n")
      .filter((line) => /\bnix (?:build|run|config show|store info)\b/.test(line))
      .filter((line) => !line.includes("$NIX_BIN"));
    assert.deepEqual(raw, [], `${label} must not invoke ambient nix:\n${raw.join("\n")}`);
  }
});
