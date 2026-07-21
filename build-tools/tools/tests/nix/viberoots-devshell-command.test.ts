#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { assertViberootsDevshellCommandStructure } from "./viberoots-devshell-command-structure";
import { assertViberootsDevshellSourceContract } from "./viberoots-devshell-source-contract";

// prettier-ignore
const generatedSnapshotRoots = [".viberoots/buck", ".viberoots/cache", ".viberoots/codex-test-logs", ".viberoots/workspace/buck/unified-pnpm-store", ".viberoots/workspace/buck/codex-test-logs", ".viberoots/workspace/buck/test-logs", ".viberoots/workspace/buck/verify-logs", ".viberoots/workspace/buck/home", ".viberoots/workspace/buck/tmp", ".viberoots/workspace/codex-test-logs", ".viberoots/workspace/install-cache", "buck-out", "node_modules", "dist", "build", "coverage"];

test("devshell wires viberoots as a Nix-provided PATH command", async (t) => {
  await assertViberootsDevshellSourceContract();
  const devshell = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/devshell.nix"),
    "utf8",
  );
  const packagedCommand = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/packages/viberoots-command.nix"),
    "utf8",
  );
  await assertViberootsDevshellCommandStructure(devshell, packagedCommand);

  const artifactToolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: viberootsSourcePath("."),
    attr: "viberoots",
    logPrefix: "[viberoots-devshell-command]",
    env: buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot }),
    selectorEnv: {},
  });
  try {
    for (const generatedRoot of generatedSnapshotRoots) {
      await assert.rejects(
        fsp.lstat(path.join(filtered.workspaceRoot, generatedRoot)),
        { code: "ENOENT" },
        `filtered devshell snapshot must exclude ${generatedRoot}`,
      );
    }

    const nixEnv = { ...process.env };
    for (const key of [
      "NIX_PNPM_ALLOW_GENERATE",
      "NIX_PNPM_MATERIALIZE",
      "NIX_PNPM_RECONCILE",
      "NIX_PNPM_EXACT_STORE",
      "NIX_PNPM_EXACT_STORE_MAP",
      "NIX_PNPM_EXACT_STORE_INDEX",
      "NIX_PNPM_EXACT_STORE_LOCK_HASH",
    ]) {
      delete nixEnv[key];
    }
    assert.equal(nixEnv.NIX_PNPM_RECONCILE, undefined);
    assert.equal(nixEnv.NIX_PNPM_MATERIALIZE, undefined);
    const built = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: nixEnv,
    })`nix build --accept-flake-config ${filtered.flakeRef} --no-link --print-out-paths`;

    assert.equal(
      built.exitCode,
      0,
      `expected nix build viberoots#viberoots to succeed\nstdout:\n${built.stdout}\nstderr:\n${built.stderr}`,
    );
    assert.doesNotMatch(String(built.stderr || ""), /explicitly reconciling|pnpm fetch/i);
    const outPath =
      String(built.stdout || "")
        .trim()
        .split(/\r?\n/)
        .at(-1) || "";
    assert.match(outPath, /^\/nix\/store\/.+-viberoots$/);
    const closure = execFileSync("nix-store", ["--query", "--requisites", outPath], {
      encoding: "utf8",
    });
    assert.doesNotMatch(
      closure,
      /node-modules-lock-/,
      "packaged viberoots command must not retain an eager node_modules closure",
    );
    const realizedCommand = await fsp.readFile(path.join(outPath, "bin", "viberoots"), "utf8");
    const sourceRoot = realizedCommand.match(/helper="([^"]+)\/build-tools\//)?.[1] || "";
    const fixture = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-minimal-")));
    t.after(async () => await fsp.rm(fixture, { recursive: true, force: true }));
    await fsp.writeFile(path.join(fixture, ".buckroot"), ".\n");
    await fsp.writeFile(path.join(fixture, "flake.nix"), "{ outputs = _: {}; }\n");
    assert.equal(await fsp.stat(path.join(sourceRoot, "node_modules")).catch(() => null), null);
    const minimalEnv = {
      HOME: process.env.HOME,
      PATH: `${path.join(outPath, "bin")}:/usr/bin:/bin`,
      WORKSPACE_ROOT: fixture,
    };
    const initialized = execFileSync(
      path.join(outPath, "bin", "viberoots"),
      ["init-workspace", "--workspace-root", fixture, "--source", sourceRoot, "--json"],
      { cwd: fixture, encoding: "utf8", env: minimalEnv },
    );
    assert.equal(JSON.parse(initialized).workspaceRoot, fixture);
    const minimalStatus = execFileSync(
      path.join(outPath, "bin", "viberoots"),
      ["status", "--json"],
      {
        cwd: fixture,
        encoding: "utf8",
        env: minimalEnv,
      },
    );
    assert.equal(JSON.parse(minimalStatus).workspaceRoot, fixture);
    assert.equal(await fsp.stat(path.join(fixture, "node_modules")).catch(() => null), null);
    const script = `
set -euo pipefail
cmd="$(command -v viberoots)"
printf 'cmd=%s\\n' "$cmd"
test "$cmd" = "${path.join(outPath, "bin", "viberoots")}"
viberoots version --json
`;
    const run = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        PATH: `${path.join(outPath, "bin")}:/usr/bin:/bin`,
      },
    })`bash --noprofile --norc -c ${script}`;

    assert.equal(
      run.exitCode,
      0,
      `expected Nix-provided viberoots on PATH to run\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
    const stdout = String(run.stdout || "");
    assert.match(stdout, /^cmd=\/nix\/store\/.*\/bin\/viberoots$/m);

    const jsonStart = stdout.indexOf("{");
    assert.ok(jsonStart >= 0, "expected viberoots version --json output");
    const status = JSON.parse(stdout.slice(jsonStart));
    const expectedWorkspaceRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    assert.ok(
      status.workspaceRoot === expectedWorkspaceRoot ||
        expectedWorkspaceRoot.startsWith(`${status.workspaceRoot}${path.sep}`),
      `expected workspace root ${status.workspaceRoot} to contain ${expectedWorkspaceRoot}`,
    );
    assert.equal(status.declaredVersion, "0.0.0-dev");
    assert.equal(status.releaseTag, "v0.0.0-dev");
    assert.ok(["local", "remote"].includes(status.sourceMode));

    const yamlRun = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        PATH: `${path.join(outPath, "bin")}:/usr/bin:/bin`,
      },
    })`bash --noprofile --norc -c ${`set -euo pipefail
viberoots --help
viberoots resource-graph --help
`}`;

    assert.equal(
      yamlRun.exitCode,
      0,
      `expected minimal Nix-provided viberoots help paths to run\nstdout:\n${yamlRun.stdout}\nstderr:\n${yamlRun.stderr}`,
    );
    assert.match(String(yamlRun.stdout || ""), /viberoots commands:/);
    assert.match(String(yamlRun.stdout || ""), /viberoots resource-graph export/);
    assert.doesNotMatch(String(yamlRun.stdout || ""), /source mode:/);
  } finally {
    await filtered.cleanup();
  }
});
