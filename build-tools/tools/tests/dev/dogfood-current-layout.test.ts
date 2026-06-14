#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type CommandResult = {
  exitCode: number | null;
  stdout: unknown;
  stderr: unknown;
};

function buckconfigSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = new Map();
      sections.set(header[1], current);
      continue;
    }
    const split = line.indexOf("=");
    if (current && split >= 0) {
      current.set(line.slice(0, split).trim(), line.slice(split + 1).trim());
    }
  }
  return sections;
}

async function assertSuccess(result: CommandResult, description: string): Promise<string> {
  assert.equal(
    result.exitCode,
    0,
    `${description} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return String(result.stdout || "");
}

test("dogfood buckconfig routes viberoots-owned cells through current", async () => {
  const sections = buckconfigSections(await fsp.readFile(".buckconfig", "utf8"));
  const expected = new Map([
    ["viberoots", "./.viberoots/current"],
    ["prelude", "./.viberoots/current/prelude"],
    ["toolchains", "./.viberoots/current/toolchains"],
    ["repo_toolchains", "./.viberoots/current/toolchains"],
    ["config", "./.viberoots/current/prelude"],
    ["fbsource", "./.viberoots/current/config/fbsource_stub"],
    ["fbcode", "./.viberoots/current/config/fbcode_stub"],
    ["workspace_providers", "./.viberoots/workspace/providers"],
  ]);

  for (const sectionName of ["repositories", "cells"]) {
    const section = sections.get(sectionName);
    assert.ok(section, `missing .buckconfig [${sectionName}] section`);
    for (const [cell, value] of expected) {
      assert.equal(section.get(cell), value, `[${sectionName}] ${cell}`);
    }
  }
});

test("dogfood workflows use local current source and workspace providers", async () => {
  assert.equal(await fsp.readlink(".viberoots/current"), "..");
  assert.equal(await fsp.realpath(".viberoots/current"), process.cwd());

  const marker = path.join("build-tools", "tmp", `dogfood-live-edit-${process.pid}.txt`);
  await fsp.mkdir(path.dirname(marker), { recursive: true });
  try {
    await fsp.writeFile(marker, "live\n", "utf8");
    assert.equal(await fsp.readFile(path.join(".viberoots/current", marker), "utf8"), "live\n");
  } finally {
    await fsp.rm(marker, { force: true });
  }

  const devshell = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix develop --accept-flake-config .#default -c bash --noprofile --norc -c ${`
set -euo pipefail
test "$(readlink .viberoots/current)" = ".."
test "$VIBEROOTS_ROOT" = "$PWD"
command -v buck2 >/dev/null
command -v viberoots >/dev/null
viberoots version --json
`}`;
  const devshellOut = await assertSuccess(devshell, "nix develop dogfood tool smoke");
  const status = JSON.parse(devshellOut.slice(devshellOut.indexOf("{")));
  assert.equal(status.sourceMode, "local");
  assert.equal(status.viberootsRoot, process.cwd());
  assert.equal(status.currentPointsToLiveCheckout, true);

  const projects = await assertSuccess(
    await $({ stdio: "pipe", reject: false, nothrow: true })`buck2 targets //projects/...`,
    "Buck projects parse",
  );
  assert.match(projects, /root\/\/projects\/apps\/pleomino:app/);
  assert.match(projects, /root\/\/projects\/libs\/pleomino-solver-wasm:solver_emscripten/);

  await assertSuccess(
    await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 targets //build-tools/deployments/...`,
    "root build-tools compatibility parse",
  );

  const providers = await assertSuccess(
    await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 targets workspace_providers//...`,
    "workspace provider cell parse",
  );
  assert.match(providers, /workspace_providers\/\/:lf_/);

  const deps = await assertSuccess(
    await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms prelude//platforms:default ${"deps(//projects/apps/pleomino:app_raw)"}`,
    "workspace provider consumption cquery",
  );
  assert.match(deps, /workspace_providers\/\/:lf_/);
});
