#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { direnvStage0, envrc, filterCapturedHostPath } from "../../lib/consumer-direnv";
import {
  GENERATED_REPO_STATE_PATHS,
  normalizeGeneratedRelPath,
} from "../../lib/generated-repo-state";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);

test("generated .envrc delegates to stable stage-0 helper before nix-direnv use flake", async () => {
  const generatedEnvrc = envrc();
  assert.match(generatedEnvrc, /\.viberoots\/bootstrap\/direnv-stage0\.sh/);
  assert.match(generatedEnvrc, /error: viberoots direnv stage-0 helper is missing\./);
  assert.match(generatedEnvrc, /run: viberoots bootstrap-check --repair-if-needed/);
  assert.match(generatedEnvrc, /source "\$\{__vbr_stage0\}"/);
  assert.doesNotMatch(generatedEnvrc, /use flake/);
  assert.doesNotMatch(generatedEnvrc, /__vbr_flake_input_root/);
  assert.doesNotMatch(generatedEnvrc, /nix cache health/);
  assert.doesNotMatch(generatedEnvrc, /devshell\.sh/);

  const stage0 = direnvStage0();
  assert.match(stage0, /\.viberoots\/workspace\/host-path/);
  assert.match(stage0, /__vbr_stage0_filter_host_path\(\)/);
  assert.match(stage0, /\.codex\/tmp\/arg0/);
  assert.match(stage0, /__vbr_should_write_host_path=0/);
  assert.match(stage0, /VBR_HOST_PATH/);
  assert.match(stage0, /viberoots\/build-tools\/tools\/bin/);
  assert.match(stage0, /-x "\$\{__vbr_host_path_dir\}\/codex"/);
  assert.match(stage0, /-x "\$\{__vbr_host_path_dir\}\/claude"/);
  assert.doesNotMatch(stage0, /export VBR_HOST_PATH/);
  assert.match(stage0, /source "\$\{__nix_direnv_direnvrc\}"/);
  assert.match(
    stage0,
    /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default" --accept-flake-config --no-write-lock-file "\$\{__vbr_flake_args\[@\]\}" \|\| return 1/,
  );
  const pruneHostPath = stage0.indexOf(
    'rm -f -- "${root}/exact-env-smoke.out" "${root}/host-path"',
  );
  const acquireWorkspaceFlake = stage0.indexOf('use flake "path:${PWD}/.viberoots/workspace');
  const restoreHostPath = stage0.indexOf(
    '"${__vbr_host_path}" > "${PWD}/.viberoots/workspace/host-path"',
  );
  assert.ok(pruneHostPath >= 0, "stage-0 prunes runtime leaves before Nix acquisition");
  assert.ok(acquireWorkspaceFlake > pruneHostPath, "workspace flake is acquired after pruning");
  assert.ok(
    restoreHostPath > acquireWorkspaceFlake,
    "host PATH is restored only after shell entry",
  );
  assert.match(stage0, /if \[\[ "\$\{NIX_PNPM_ALLOW_GENERATE:-\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args\+=\(--impure\)/);
  assert.doesNotMatch(stage0, /__vbr_stage0_prepare_final_pnpm_stores|prepare-final-pnpm-store/);
  assert.doesNotMatch(stage0, /eval "\$\{exact_env\}"|NIX_PNPM_EXACT_STORE/);
  assert.match(stage0, /__vbr_stage0_apply_nix_cache_health \|\| return 1/);
  assert.match(stage0, /\[env\] nix cache health: disabled unreachable substituter\(s\):/);
  assert.match(stage0, /error: viberoots workspace flake is missing\./);
  assert.match(stage0, /run: viberoots bootstrap-check --repair-if-needed/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=0/);
  assert.match(stage0, /VBR_DEVSHELL_RECONCILE/);
  assert.match(stage0, /VBR_DEVSHELL_RECONCILE[^\n]*!= "1"[\s\S]*__vbr_flake_input_root=""/);
  assert.match(
    stage0,
    /VBR_DEVSHELL_RECONCILE[^\n]*!= "1"[\s\S]*__vbr_flake_input_root=""[\s\S]*unset VIBEROOTS_FLAKE_INPUT_ROOT/,
  );
  assert.match(stage0, /VBR_DEVSHELL_USE_GENERATED_AUTHORITY/);
  assert.match(
    stage0,
    /VBR_DEVSHELL_USE_GENERATED_AUTHORITY[^\n]*== "1"[\s\S]*__vbr_flake_input_root=""/,
  );
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=1/);
  assert.match(stage0, /if \[\[ "\$\{__vbr_flake_input_is_generated_filtered\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args=\(\)/);
  assert.match(
    stage0,
    /__vbr_flake_args=\(--override-input viberoots "path:\$\{__vbr_flake_input_root\}"\)/,
  );
  assert.match(stage0, /! -f "\$\{__vbr_flake_input_root\}\/flake\.nix"/);
  assert.match(stage0, /__vbr_stage0_filtered_viberoots_input\(\)/);
  for (const rel of GENERATED_REPO_STATE_PATHS.map(normalizeGeneratedRelPath)) {
    assert.ok(stage0.includes(`--exclude /${rel}`), `stage-0 excludes generated state: ${rel}`);
  }
  assert.match(stage0, /__vbr_stage0_align_workspace_flake_input\(\)/);
  assert.match(stage0, /viberoots\.url = "path:\.\/viberoots-flake-input"/);
  assert.match(stage0, /__vbr_stage0_align_workspace_flake_input\(\).*\.source-fingerprint/s);
  assert.match(stage0, /viberoots-flake-input/);
  assert.match(stage0, /\.source-fingerprint/);
  assert.match(stage0, /__vbr_current_real.*__vbr_filtered_real/s);
  assert.match(stage0, /__vbr_input_real.*__vbr_filtered_real/s);
  assert.match(stage0, /__vbr_flake_input_root="\$\{PWD\}\/viberoots"/);
  assert.match(stage0, /readlink "\$\{PWD\}\/\.viberoots\/current"/);
  assert.match(stage0, /!= "\.\.\/viberoots"/);
  assert.match(stage0, /rm -f "\$\{PWD\}\/\.viberoots\/current" && ln -s \.\.\/viberoots/);
  assert.match(stage0, /unset -f __vbr_stage0_filter_host_path/);
  assert.match(stage0, /unset -f .*__vbr_stage0_align_workspace_flake_input/);
  assert.doesNotMatch(stage0, /__vbr_stage0_prepare_final_pnpm_stores/);
  const updateEntry = await fsp.readFile(
    path.join(VIBEROOTS_SOURCE_ROOT, "build-tools", "tools", "bin", "u"),
    "utf8",
  );
  assert.match(
    updateEntry,
    /unset VBR_DEVSHELL_USE_GENERATED_AUTHORITY[\s\S]*export VBR_DEVSHELL_RECONCILE=1[\s\S]*devshell\.sh/,
  );
});

test("captured host path filtering removes transient Codex arg0 shim directories", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-host-path-"));
  try {
    const home = path.join(tmp, "home");
    const ordinaryBin = path.join(tmp, "bin");
    const arg0Root = path.join(home, ".codex", "tmp", "arg0");
    const transientBin = path.join(arg0Root, "session", "bin");
    await fsp.mkdir(ordinaryBin, { recursive: true });
    await fsp.mkdir(transientBin, { recursive: true });

    const filtered = filterCapturedHostPath(
      [ordinaryBin, arg0Root, transientBin, "/usr/bin"].join(path.delimiter),
      home,
    );

    assert.equal(filtered, [ordinaryBin, "/usr/bin"].join(path.delimiter));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("stage-0 filtered input removes stale generated state from its owned destination", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-stage0-filtered-input-"));
  try {
    const source = path.join(tmp, "viberoots");
    const destination = path.join(tmp, ".viberoots", "workspace", "viberoots-flake-input");
    await fsp.mkdir(source, { recursive: true });
    await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(source, "source.txt"), "current source\n", "utf8");
    for (const rel of [".nix-gcroots/devshell", ".nix-zsh/profile", ".codex-logs/run.log"]) {
      await fsp.mkdir(path.dirname(path.join(source, rel)), { recursive: true });
      await fsp.writeFile(path.join(source, rel), "generated\n", "utf8");
      await fsp.mkdir(path.dirname(path.join(destination, rel)), { recursive: true });
      await fsp.writeFile(path.join(destination, rel), "stale\n", "utf8");
    }
    await fsp.mkdir(destination, { recursive: true });
    await fsp.writeFile(path.join(source, "test-tmp-paths.log"), "generated\n", "utf8");
    await fsp.writeFile(path.join(destination, "test-tmp-paths.log"), "stale\n", "utf8");

    const stage0 = direnvStage0();
    const filteredFunction = stage0.match(
      /(__vbr_stage0_filtered_viberoots_input\(\) \{[\s\S]*?\n\})\n\n__vbr_stage0_align_workspace_flake_input/,
    )?.[1];
    assert.ok(filteredFunction, "generated stage-0 contains the filtered-input function");
    await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `set -euo pipefail\ncd "$1"\n${filteredFunction}\n__vbr_stage0_filtered_viberoots_input "$PWD/viberoots" >/dev/null`,
        "stage0-filtered-input-test",
        tmp,
      ],
      { env: process.env },
    );

    assert.equal(
      await fsp.readFile(path.join(destination, "source.txt"), "utf8"),
      "current source\n",
    );
    for (const rel of [
      ".nix-gcroots/devshell",
      ".nix-zsh/profile",
      ".codex-logs/run.log",
      "test-tmp-paths.log",
    ]) {
      await assert.rejects(fsp.access(path.join(destination, rel)), { code: "ENOENT" });
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
