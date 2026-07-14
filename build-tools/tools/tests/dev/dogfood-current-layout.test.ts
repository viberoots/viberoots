#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

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

test("dogfood buckconfig routes source cells through current and generated cells through workspace", async () => {
  const disallowedOldLayoutPaths = [
    "TESTING.md",
    "TARGETS",
    "build-tools/tools",
    "config",
    "docs",
    "eslint.config.js",
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
  const agentNotesPath =
    (await fsp
      .stat(path.join(process.cwd(), "AGENTS.md"))
      .then((stat) => (stat.isFile() ? "AGENTS.md" : null))
      .catch(() => null)) ?? "projects/AGENTS.md";
  assert.equal((await fsp.stat(path.join(process.cwd(), agentNotesPath))).isFile(), true);
  assert.equal((await fsp.stat(path.join(process.cwd(), "flake.nix"))).isFile(), true);

  const sections = buckconfigSections(await fsp.readFile(".buckconfig", "utf8"));
  assert.equal(sections.get("project")?.get("ignore")?.includes(".git"), true);
  assert.equal(sections.get("project")?.get("ignore")?.includes(".direnv"), true);
  const expected = new Map([
    ["viberoots", "./.viberoots/current"],
    ["prelude", "./.viberoots/workspace/prelude"],
    ["toolchains", "./.viberoots/current/toolchains"],
    ["repo_toolchains", "./.viberoots/workspace/toolchains"],
    ["config", "./.viberoots/current/config"],
    ["fbsource", "./.viberoots/current/config/fbsource_stub"],
    ["fbcode", "./.viberoots/current/config/fbcode_stub"],
    ["workspace_providers", "./.viberoots/workspace/providers"],
    ["workspace_buck", "./.viberoots/workspace/buck"],
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
  const liveViberootsRoot = path.join(process.cwd(), "viberoots");
  const currentLink = await fsp.readlink(".viberoots/current");
  const viberootsRoot = await fsp.realpath(".viberoots/current");
  const currentIsLive = currentLink === "../viberoots";
  const buckIsolation = stableBuckIsolation(process.cwd(), "dogfood-current-layout");
  if (currentIsLive) {
    assert.equal(viberootsRoot, liveViberootsRoot);
  } else {
    assert.match(viberootsRoot, /^\/nix\/store\/[a-z0-9]{32}-source(?:\/|$)/);
  }
  await fsp.mkdir(path.join(process.cwd(), "buck-out", "v2"), { recursive: true });

  if (currentIsLive) {
    const marker = path.join("build-tools", "tmp", `dogfood-live-edit-${process.pid}.txt`);
    const markerAbs = path.join(viberootsRoot, marker);
    await fsp.mkdir(path.dirname(markerAbs), { recursive: true });
    try {
      await fsp.writeFile(markerAbs, "live\n", "utf8");
      assert.equal(await fsp.readFile(path.join(".viberoots/current", marker), "utf8"), "live\n");
    } finally {
      await fsp.rm(markerAbs, { force: true });
    }
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
  assert.equal(status.sourceMode, currentIsLive ? "local" : "remote");
  assert.equal(status.viberootsRoot, viberootsRoot);
  assert.equal(status.currentPointsToLiveCheckout, currentIsLive);

  try {
    await assertSuccess(
      await $({
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${buckIsolation} targets //projects/...`,
      "Buck projects parse",
    );

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
    assert.match(providers, /workspace_providers\/\/:/);
  } finally {
    await $({
      stdio: "ignore",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${buckIsolation} kill`;
  }
});

test("workspace provider consumption works in a temp consumer repo", async () => {
  await runInTemp("dogfood-provider-consumption", async (tmp, zx) => {
    const targetsPath = path.join(tmp, "projects/apps/sample-webapp/TARGETS");
    await fsp.mkdir(path.dirname(targetsPath), { recursive: true });
    await fsp.writeFile(
      targetsPath,
      [
        'load("@workspace_providers//:defs_cpp.bzl", "nix_cxx_library")',
        "",
        'nix_cxx_library(name = "zlib", attr = "pkgs.zlib")',
        "",
      ].join("\n"),
      "utf8",
    );

    const deps = await assertSuccess(
      await zx({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${inheritedBuckIsolation("dogfood-provider-consumption")} cquery --target-platforms prelude//platforms:default ${"deps(//projects/apps/sample-webapp:zlib)"}`,
      "workspace provider consumption cquery",
    );
    assert.match(deps, /root\/\/projects\/apps\/sample-webapp:zlib/);
  });
});
