#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { direnvStage0 } from "../../lib/consumer-direnv";

test("generated .envrc delegates to stable stage-0 helper before nix-direnv use flake", async () => {
  const envrc = await fsp.readFile(path.join(process.cwd(), ".envrc"), "utf8");
  assert.match(envrc, /\.viberoots\/bootstrap\/direnv-stage0\.sh/);
  assert.match(envrc, /error: viberoots direnv stage-0 helper is missing\./);
  assert.match(envrc, /run: viberoots bootstrap-check --repair-if-needed/);
  assert.match(envrc, /source "\$\{__vbr_stage0\}"/);
  assert.doesNotMatch(envrc, /use flake/);
  assert.doesNotMatch(envrc, /__vbr_flake_input_root/);
  assert.doesNotMatch(envrc, /nix cache health/);
  assert.doesNotMatch(envrc, /devshell\.sh/);

  const stage0 = direnvStage0();
  assert.match(stage0, /source "\$\{__nix_direnv_direnvrc\}"/);
  assert.match(
    stage0,
    /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default" --accept-flake-config "\$\{__vbr_flake_args\[@\]\}"/,
  );
  assert.match(stage0, /__vbr_stage0_apply_nix_cache_health \|\| return 1/);
  assert.match(stage0, /\[env\] nix cache health: disabled unreachable substituter\(s\):/);
  assert.match(stage0, /error: viberoots workspace flake is missing\./);
  assert.match(stage0, /run: viberoots bootstrap-check --repair-if-needed/);
  assert.match(
    stage0,
    /__vbr_flake_args=\(--override-input viberoots "path:\$\{__vbr_flake_input_root\}"\)/,
  );
  assert.match(stage0, /! -f "\$\{__vbr_flake_input_root\}\/flake\.nix"/);
  assert.match(stage0, /__vbr_stage0_filtered_viberoots_input\(\)/);
  assert.match(stage0, /viberoots-flake-input/);
  assert.match(stage0, /\.source-fingerprint/);
  assert.match(stage0, /__vbr_current_real.*__vbr_filtered_real/s);
  assert.match(stage0, /ln -sfn \.\.\/viberoots/);
  assert.match(stage0, /unset -f .*__vbr_stage0_apply_nix_cache_health/);
});
