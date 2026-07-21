import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export async function assertViberootsDevshellSourceContract(): Promise<void> {
  const devshell = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/devshell.nix"),
    "utf8",
  );
  const packaged = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/packages/viberoots-command.nix"),
    "utf8",
  );
  assert.match(devshell, /viberootsCommand = import \.\/packages\/viberoots-command\.nix/);
  assert.match(packaged, /\[ -x \/nix\/var\/nix\/profiles\/default\/bin\/nix \]/);
  assert.match(packaged, /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/);
  assert.match(packaged, /export VBR_NIX_BIN="\$\{pkgs\.nix\}\/bin\/nix"/);
  assert.match(packaged, /export NIX_BIN="\$VBR_NIX_BIN"/);
  assert.match(packaged, /export GIT_BIN="\$\{pkgs\.git\}\/bin\/git"/);
  assert.match(packaged, /export VBR_ARTIFACT_TOOLS_ROOT="\$\{artifactToolsRoot\}"/);
  assert.match(
    packaged,
    /export PATH="\$\{pkgs\.git\}\/bin:\$\{pkgs\.rsync\}\/bin:\$\(dirname "\$VBR_NIX_BIN"\):\$PATH"/,
  );
  assert.doesNotMatch(packaged, /export NIX_BIN="\$\{pkgs\.nix\}\/bin\/nix"/);
  assert.doesNotMatch(packaged, /viberootsNodeModules|VIBEROOTS_NODE_PATH|NODE_PATH/);
  assert.doesNotMatch(devshell, /viberootsNodeModules|viberootsNodePath|VIBEROOTS_NODE_PATH/);
  for (const pattern of [
    /entry_cwd="\$PWD"/,
    /dev_root="''\$\{WORKSPACE_ROOT:-\$PWD\}"/,
    /cd "\$entry_cwd"/,
    /buildInputs = \[[^\]]*\bviberootsCommand\b/s,
    /local vbr_host_nix_bin=""/,
    /\/nix\/var\/nix\/profiles\/default\/bin\/nix/,
    /export PATH="\$repo_prefix:/,
    /export VIBEROOTS_ROOT="\$PWD"/,
    /viberoots init-workspace --shell-entry --source "\$PWD"/,
    /viberoots init-workspace --shell-entry >\/dev\/null/,
    /export VIBEROOTS_ROOT="\$vbr_source"/,
    /eval "\$\(vbr completion zsh\)"/,
    /eval "\$\(vbr completion bash\)"/,
  ])
    assert.match(devshell, pattern);
  assert.doesNotMatch(devshell, /eval "\$\(viberoots completion/);
  assert.doesNotMatch(devshell, /vbr_tools_bin="\$PWD\/viberoots\/build-tools\/tools\/bin"/);
  assert.doesNotMatch(devshell, /ln -s \.\.\/viberoots "\$PWD\/\.viberoots\/current"/);

  const consumer = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/lib/consumer-direnv.ts"),
    "utf8",
  );
  assert.match(consumer, /__vbr_stage0_prune_workspace_flake_generated_roots\(\)/);
  assert.match(consumer, /VBR_DEVSHELL_USE_GENERATED_AUTHORITY/);
  assert.match(
    consumer,
    /for rel in backups cache codex-test-logs install-cache nix-xdg-cache pr-logs xdg-cache/,
  );
  assert.match(consumer, /rm -rf -- "\\\$\{root\}\/\\\$\{rel\}"/);
  const activation = devshell.indexOf("viberoots init-workspace --shell-entry >/dev/null");
  const pathApply = devshell.indexOf("_vbr_prepare_tool_helpers\n      _vbr_apply_dev_path");
  assert.ok(activation >= 0 && pathApply >= 0 && activation < pathApply);
}
