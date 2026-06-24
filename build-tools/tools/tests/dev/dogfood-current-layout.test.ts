#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { stableBuckIsolation } from "../../lib/buck-command-env";

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

async function assertCommandOnPath(command: string): Promise<string> {
  const result =
    await $`bash --noprofile --norc -c ${`command -v ${JSON.stringify(command)}`}`.nothrow();
  return assertSuccess(result, `${command} path lookup`);
}

test("dogfood buckconfig routes viberoots-owned cells through current", async () => {
  const disallowedOldLayoutPaths = [
    "AI-PREFERENCES.XML",
    "METHODOLOGY.XML",
    "TESTING.md",
    "TARGETS",
    "build-tools/tools",
    "config",
    "docs",
    "eslint.config.js",
    "flake.lock",
    "flake.nix",
    "node_modules",
    "package.json",
    "patches",
    "plugins",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prelude",
    "third_party",
    "toolchains",
    "tsconfig.json",
    "types",
  ];
  for (const entry of disallowedOldLayoutPaths) {
    await assert.rejects(
      fsp.lstat(path.join(process.cwd(), entry)),
      undefined,
      `root must not contain old combined-repo entry ${entry}`,
    );
  }

  const sections = buckconfigSections(await fsp.readFile(".buckconfig", "utf8"));
  const expected = new Map([
    ["viberoots", "./.viberoots/current"],
    ["prelude", "./.viberoots/current/prelude"],
    ["toolchains", "./.viberoots/current/toolchains"],
    ["repo_toolchains", "./.viberoots/current/toolchains"],
    ["config", "./.viberoots/current/config"],
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
  const viberootsRoot = path.join(process.cwd(), "viberoots");
  const buckIsolation = stableBuckIsolation(process.cwd(), "dogfood-current-layout");
  assert.equal(await fsp.readlink(".viberoots/current"), "../viberoots");
  assert.equal(await fsp.realpath(".viberoots/current"), viberootsRoot);
  await fsp.mkdir(path.join(process.cwd(), "buck-out", "v2"), { recursive: true });

  const marker = path.join("build-tools", "tmp", `dogfood-live-edit-${process.pid}.txt`);
  const markerAbs = path.join(viberootsRoot, marker);
  await fsp.mkdir(path.dirname(markerAbs), { recursive: true });
  try {
    await fsp.writeFile(markerAbs, "live\n", "utf8");
    assert.equal(await fsp.readFile(path.join(".viberoots/current", marker), "utf8"), "live\n");
  } finally {
    await fsp.rm(markerAbs, { force: true });
  }

  assert.equal(
    await fsp.realpath(process.env.VIBEROOTS_ROOT || ""),
    await fsp.realpath(viberootsRoot),
  );
  await assertCommandOnPath("buck2");
  await assertCommandOnPath("viberoots");

  const version = await assertSuccess(
    await $({ stdio: "pipe", reject: false, nothrow: true })`viberoots version --json`,
    "viberoots version",
  );
  const status = JSON.parse(version.slice(version.indexOf("{")));
  assert.equal(status.sourceMode, "local");
  assert.equal(status.viberootsRoot, viberootsRoot);
  assert.equal(status.currentPointsToLiveCheckout, true);

  try {
    const projects = await assertSuccess(
      await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${buckIsolation} targets //projects/...`,
      "Buck projects parse",
    );
    assert.match(projects, /root\/\/projects\/apps\/pleomino:app/);
    assert.match(projects, /root\/\/projects\/libs\/pleomino-solver-wasm:solver_emscripten/);

    await assertSuccess(
      await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${buckIsolation} targets viberoots//build-tools/deployments/...`,
      "viberoots build-tools cell parse",
    );

    const providers = await assertSuccess(
      await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${buckIsolation} targets workspace_providers//...`,
      "workspace provider cell parse",
    );
    assert.match(providers, /workspace_providers\/\/:lf_/);

    const deps = await assertSuccess(
      await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${buckIsolation} cquery --target-platforms prelude//platforms:default ${"deps(//projects/apps/pleomino:app_raw)"}`,
      "workspace provider consumption cquery",
    );
    assert.match(deps, /workspace_providers\/\/:lf_/);
  } finally {
    await $({
      stdio: "ignore",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${buckIsolation} kill`;
  }
});
