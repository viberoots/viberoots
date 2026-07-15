#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

// prettier-ignore
const generatedSnapshotRoots = [".viberoots/buck", ".viberoots/cache", ".viberoots/codex-test-logs", ".viberoots/workspace/buck/unified-pnpm-store", ".viberoots/workspace/buck/codex-test-logs", ".viberoots/workspace/buck/test-logs", ".viberoots/workspace/buck/verify-logs", ".viberoots/workspace/buck/home", ".viberoots/workspace/buck/tmp", ".viberoots/workspace/codex-test-logs", ".viberoots/workspace/install-cache", "buck-out", "node_modules", "dist", "build", "coverage"];

test("devshell wires viberoots as a Nix-provided PATH command", async (t) => {
  const devshell = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/devshell.nix"),
    "utf8",
  );
  const packagedCommand = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/packages/viberoots-command.nix"),
    "utf8",
  );
  assert.match(devshell, /viberootsCommand = import \.\/packages\/viberoots-command\.nix/);
  assert.match(packagedCommand, /\[ -x \/nix\/var\/nix\/profiles\/default\/bin\/nix \]/);
  assert.match(
    packagedCommand,
    /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/,
  );
  assert.match(packagedCommand, /export VBR_NIX_BIN="\$\{pkgs\.nix\}\/bin\/nix"/);
  assert.match(packagedCommand, /export NIX_BIN="\$VBR_NIX_BIN"/);
  assert.match(packagedCommand, /export GIT_BIN="\$\{pkgs\.git\}\/bin\/git"/);
  assert.match(
    packagedCommand,
    /export PATH="\$\{pkgs\.git\}\/bin:\$\{pkgs\.rsync\}\/bin:\$\(dirname "\$VBR_NIX_BIN"\):\$PATH"/,
  );
  assert.doesNotMatch(packagedCommand, /export NIX_BIN="\$\{pkgs\.nix\}\/bin\/nix"/);
  assert.doesNotMatch(packagedCommand, /export VBR_NIX_BIN="''\$\{VBR_NIX_BIN:-\$NIX_BIN\}"/);
  assert.doesNotMatch(packagedCommand, /viberootsNodeModules|VIBEROOTS_NODE_PATH|NODE_PATH/);
  assert.doesNotMatch(devshell, /viberootsNodeModules|viberootsNodePath|VIBEROOTS_NODE_PATH/);
  assert.match(devshell, /entry_cwd="\$PWD"/);
  assert.match(devshell, /dev_root="''\$\{WORKSPACE_ROOT:-\$PWD\}"/);
  assert.match(devshell, /dev_root="\$\(cd "\$WORKSPACE_ROOT" && pwd\)"/);
  assert.match(devshell, /local d="''\$\{WORKSPACE_ROOT:-\$PWD\}"/);
  assert.match(devshell, /\( -n "''\$\{WORKSPACE_ROOT:-\}" \|\| -f "\$d\/flake\.nix" \)/);
  assert.match(devshell, /cd "\$entry_cwd"/);
  assert.match(devshell, /buildInputs = \[[^\]]*\bviberootsCommand\b/s);
  assert.match(devshell, /local vbr_host_nix_bin=""/);
  assert.match(devshell, /\[ -n "''\$\{VBR_NIX_BIN:-\}" \] && \[ -x "\$VBR_NIX_BIN" \]/);
  assert.match(devshell, /\/nix\/var\/nix\/profiles\/default\/bin\/nix/);
  assert.match(devshell, /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/);
  assert.match(devshell, /export PATH="\$repo_prefix:/);
  assert.match(devshell, /-f "\$PWD\/build-tools\/tools\/dev\/viberoots\.ts"/);
  assert.match(devshell, /vbr_tools_bin="\$PWD\/build-tools\/tools\/bin"/);
  assert.match(devshell, /-f "\$d\/build-tools\/tools\/dev\/viberoots\.ts"/);
  assert.match(devshell, /vbr_tools_bin="\$d\/build-tools\/tools\/bin"/);
  assert.match(devshell, /vbr_tools_bin="\$PWD\/\.viberoots\/current\/build-tools\/tools\/bin"/);
  assert.match(devshell, /vbr_tools_bin="\$d\/\.viberoots\/current\/build-tools\/tools\/bin"/);
  assert.doesNotMatch(devshell, /vbr_tools_bin="\$PWD\/viberoots\/build-tools\/tools\/bin"/);
  assert.doesNotMatch(devshell, /vbr_tools_bin="\$d\/viberoots\/build-tools\/tools\/bin"/);
  assert.doesNotMatch(devshell, /\[ -f "\$PWD\/viberoots\/flake\.nix" \]/);
  assert.doesNotMatch(devshell, /ln -s \.\.\/viberoots "\$PWD\/\.viberoots\/current"/);
  assert.match(devshell, /local repo_prefix="\$vbr_tools_bin:\$PWD\/\.direnv\/bin:\$vbr_node_bin"/);
  assert.match(devshell, /\[ -f "\$PWD\/\.viberoots\/workspace\/flake\.nix" \]/);
  assert.match(devshell, /export VIBEROOTS_ROOT="\$PWD"/);
  assert.match(devshell, /viberoots init-workspace --shell-entry --source "\$PWD"/);
  assert.match(devshell, /vbr_flake_input_root="''\$\{VIBEROOTS_FLAKE_INPUT_ROOT:-\}"/);
  assert.match(devshell, /vbr_source_root="''\$\{VIBEROOTS_SOURCE_ROOT:-\$vbr_flake_input_root\}"/);
  assert.match(devshell, /viberoots init-workspace --shell-entry --source "\$vbr_source_root"/);
  assert.match(devshell, /viberoots init-workspace --shell-entry >\/dev\/null/);
  assert.match(devshell, /vbr_source="\$\(cd "\$PWD\/\.viberoots\/current" && pwd -P\)"/);
  assert.match(devshell, /export VIBEROOTS_ROOT="\$vbr_source"/);
  const consumerDirenv = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/lib/consumer-direnv.ts"),
    "utf8",
  );
  assert.match(consumerDirenv, /__vbr_stage0_prune_workspace_flake_generated_roots\(\)/);
  assert.match(
    consumerDirenv,
    /for rel in backups cache codex-test-logs install-cache nix-xdg-cache pr-logs xdg-cache/,
  );
  assert.match(consumerDirenv, /rm -rf -- "\\\$\{root\}\/\\\$\{rel\}"/);
  assert.match(
    consumerDirenv,
    /__vbr_stage0_prune_workspace_flake_generated_roots\n\nwatch_file \.viberoots\/workspace\/flake\.nix/,
  );
  const consumerActivation = devshell.indexOf("viberoots init-workspace --shell-entry >/dev/null");
  const finalPathApply = devshell.indexOf("_vbr_prepare_tool_helpers\n      _vbr_apply_dev_path");
  assert.ok(consumerActivation >= 0, "expected consumer workspace activation");
  assert.ok(finalPathApply >= 0, "expected final dev PATH application");
  assert.ok(
    consumerActivation < finalPathApply,
    "expected consumer activation to run before final dev PATH application",
  );
  assert.match(devshell, /eval "\$\(vbr completion zsh\)"/);
  assert.match(devshell, /eval "\$\(vbr completion bash\)"/);
  assert.doesNotMatch(devshell, /eval "\$\(viberoots completion/);

  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: viberootsSourcePath("."),
    attr: "viberoots",
    logPrefix: "[viberoots-devshell-command]",
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
