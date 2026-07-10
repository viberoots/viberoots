#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { direnvStage0, envrc, filterCapturedHostPath } from "../../lib/consumer-direnv";

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
    /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default" --accept-flake-config --no-write-lock-file "\$\{__vbr_flake_args\[@\]\}"/,
  );
  assert.match(stage0, /if \[\[ "\$\{NIX_PNPM_ALLOW_GENERATE:-\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args\+=\(--impure\)/);
  assert.match(stage0, /__vbr_stage0_apply_nix_cache_health \|\| return 1/);
  assert.match(stage0, /\[env\] nix cache health: disabled unreachable substituter\(s\):/);
  assert.match(stage0, /error: viberoots workspace flake is missing\./);
  assert.match(stage0, /run: viberoots bootstrap-check --repair-if-needed/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=0/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=1/);
  assert.match(stage0, /if \[\[ "\$\{__vbr_flake_input_is_generated_filtered\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args=\(\)/);
  assert.match(
    stage0,
    /__vbr_flake_args=\(--override-input viberoots "path:\$\{__vbr_flake_input_root\}"\)/,
  );
  assert.match(stage0, /! -f "\$\{__vbr_flake_input_root\}\/flake\.nix"/);
  assert.match(stage0, /__vbr_stage0_filtered_viberoots_input\(\)/);
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
