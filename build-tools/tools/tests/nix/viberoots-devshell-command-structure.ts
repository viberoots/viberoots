import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export async function assertViberootsDevshellCommandStructure(
  devshell: string,
  packagedCommand: string,
): Promise<void> {
  assert.match(
    packagedCommand,
    /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/,
  );
  assert.match(
    packagedCommand,
    /export PATH="\$\{pkgs\.git\}\/bin:\$\{pkgs\.rsync\}\/bin:\$\(dirname "\$VBR_NIX_BIN"\):\$PATH"/,
  );
  assert.doesNotMatch(packagedCommand, /export VBR_NIX_BIN="''\$\{VBR_NIX_BIN:-\$NIX_BIN\}"/);
  assert.match(devshell, /dev_root="\$\(cd "\$WORKSPACE_ROOT" && pwd\)"/);
  assert.match(devshell, /local d="''\$\{WORKSPACE_ROOT:-\$PWD\}"/);
  assert.match(devshell, /\( -n "''\$\{WORKSPACE_ROOT:-\}" \|\| -f "\$d\/flake\.nix" \)/);
  assert.match(devshell, /\[ -n "''\$\{VBR_NIX_BIN:-\}" \] && \[ -x "\$VBR_NIX_BIN" \]/);
  assert.match(devshell, /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/);
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
  assert.match(
    devshell,
    /VIBEROOTS_FLAKE_INPUT_ROOT="\$vbr_flake_input_root"[\s\S]*viberoots init-workspace --shell-entry --source "\$vbr_flake_input_root"/,
  );
  assert.doesNotMatch(devshell, /export VIBEROOTS_FLAKE_INPUT_ROOT="\$vbr_flake_input_root"/);
  assert.match(
    devshell,
    /_vbr_apply_dev_path\s+unset VIBEROOTS_FLAKE_INPUT_ROOT\s+if \[ -f "\$VIBEROOTS_ROOT\/build-tools\/tools\/bin\/artifact-ingress-env\.sh" \]/,
  );
  assert.match(devshell, /viberoots init-workspace --shell-entry --source "\$vbr_source_root"/);
  assert.match(devshell, /viberoots init-workspace --shell-entry >\/dev\/null/);
  assert.match(devshell, /vbr_source="\$\(cd "\$PWD\/\.viberoots\/current" && pwd -P\)"/);
  assert.match(devshell, /export VIBEROOTS_ROOT="\$vbr_source"/);

  const consumerDirenv = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/lib/consumer-direnv.ts"),
    "utf8",
  );
  assert.match(consumerDirenv, /__vbr_stage0_prune_workspace_flake_generated_roots\(\)/);
  assert.match(consumerDirenv, /VBR_DEVSHELL_USE_GENERATED_AUTHORITY/);
  assert.match(
    consumerDirenv,
    /for rel in backups cache codex-test-logs install-cache nix-xdg-cache pr-logs xdg-cache/,
  );
  assert.match(consumerDirenv, /rm -rf -- "\\\$\{root\}\/\\\$\{rel\}"/);
  assert.match(
    consumerDirenv,
    /rm -f -- "\\\$\{root\}\/exact-env-smoke\.out" "\\\$\{root\}\/host-path"/,
  );
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
}
