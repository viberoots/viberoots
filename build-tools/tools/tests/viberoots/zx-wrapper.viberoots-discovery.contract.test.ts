#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function sourceRoot(): Promise<string> {
  const cwd = process.cwd();
  const nested = path.join(cwd, "viberoots", "build-tools", "tools");
  try {
    const stat = await fsp.stat(nested);
    if (stat.isDirectory()) return path.join(cwd, "viberoots");
  } catch {}
  return cwd;
}

test("zx-wrapper resolves build-tools script arguments from the active viberoots root", async () => {
  const root = await sourceRoot();
  const wrapperPath = path.join(root, "build-tools", "tools", "nix", "lib", "zx-wrapper.nix");
  const source = await fsp.readFile(wrapperPath, "utf8");

  assert.match(source, /_viberoots_root=/);
  assert.match(source, /build-tools\/tools\/\*/);
  assert.match(source, /!\s+-e "\$1"/);
  assert.match(source, /"\$_viberoots_root\/\$1"/);
});

test("runInTemp installs a zx-wrapper shim for temp-repo build-tools command paths", async () => {
  const root = await sourceRoot();
  const helperPath = path.join(
    root,
    "build-tools",
    "tools",
    "tests",
    "lib",
    "test-helpers",
    "run-in-temp",
    "command-shims.ts",
  );
  const source = await fsp.readFile(helperPath, "utf8");

  assert.match(source, /createTempZxWrapperShim/);
  assert.match(source, /build-tools\/\*/);
  assert.match(source, /VIBEROOTS_ROOT/);
  assert.match(source, /real_zx_wrapper/);
});

test("bin run_ts resolves relative tool scripts from the active viberoots root", async () => {
  const root = await sourceRoot();
  const helperPath = path.join(root, "build-tools", "tools", "bin", "devshell.sh");
  const source = await fsp.readFile(helperPath, "utf8");

  assert.match(
    source,
    /live_target_ts="\$\{LIVE_ROOT\}\/viberoots\/build-tools\/tools\/bin\/\$\{rel_path\}"/,
  );
  assert.match(
    source,
    /\[\[ "\$\{VBR_RUN_IN_TEMP_REPO:-\}" == "1" && -f "\$\{live_target_ts\}" \]\]/,
  );
  assert.match(source, /target_ts="\$\{VIBEROOTS_ROOT\}\/build-tools\/tools\/bin\/\$\{rel_path\}"/);
  assert.doesNotMatch(source, /target_ts="\$\{SCRIPT_DIR\}\/\$\{rel_path\}"/);
});

test("bin env derives VIBEROOTS_ROOT from the live workspace rather than inherited process state", async () => {
  const root = await sourceRoot();
  const helperPath = path.join(root, "build-tools", "tools", "bin", "devshell.sh");
  const source = await fsp.readFile(helperPath, "utf8");

  assert.match(source, /VIBEROOTS_SOURCE_ROOT/);
  assert.match(source, /LIVE_ROOT\}\/\.viberoots\/current/);
  assert.match(source, /LIVE_ROOT\}\/viberoots\/build-tools\/tools\/dev\/zx-init\.mjs/);
  assert.doesNotMatch(source, /if \[\[ -z "\$\{VIBEROOTS_ROOT/);
  assert.doesNotMatch(
    source,
    /-z "\$\{SCRIPT_DIR:-\}".*-z "\$\{REPO_ROOT:-\}".*-z "\$\{LIVE_ROOT:-\}"/s,
  );
});
