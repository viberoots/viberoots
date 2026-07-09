#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("devshell.sh supports safe direnv bypass fast-path", async () => {
  const txt = await readRepoFile("build-tools/tools/bin/devshell.sh");
  if (!txt.includes("BUCK_DEV_SHELL_FASTPATH")) {
    throw new Error("devshell.sh must expose BUCK_DEV_SHELL_FASTPATH toggle");
  }
  if (!txt.includes("can_bypass_direnv")) {
    throw new Error("devshell.sh must compute explicit direnv bypass eligibility");
  }
  if (
    !txt.includes("devshell_inputs_stale") ||
    !txt.includes("devshell_stale_reload_allowed") ||
    !txt.includes(".source-fingerprint") ||
    !txt.includes("re-running this command through direnv exec") ||
    !txt.includes("VBR_DEVSHELL_STALE_RELOAD_ATTEMPTED=1") ||
    !txt.includes('exec direnv exec "$live_root" "$@"')
  ) {
    throw new Error("devshell.sh fast-path must fall back through direnv for stale shell inputs");
  }
  for (const envName of [
    "BUCK_TEST_TARGET",
    "BUCK_TEST_SRC",
    "VBR_VERIFY_LOG_FILE",
    "VBR_VERIFY_PROCESS_STATE_FILE",
    "VBR_TEST_SEED_STORE_PATH",
    "VBR_RUN_IN_TEMP_REPO",
  ]) {
    if (!txt.includes(`[[ -z "\${${envName}:-}" ]] || return 1`)) {
      throw new Error(`devshell.sh stale direnv reload must be disabled when ${envName} is set`);
    }
  }
  const execInDevShell = txt.slice(txt.indexOf("exec_in_dev_shell()"));
  if (
    execInDevShell.indexOf("devshell_stale_reload_allowed") >
    execInDevShell.indexOf("devshell_inputs_stale")
  ) {
    throw new Error("devshell.sh must check stale reload eligibility before stale inputs");
  }
  if (
    execInDevShell.indexOf("devshell_inputs_stale") > execInDevShell.indexOf("ensure_buck_prelude")
  ) {
    throw new Error("devshell.sh must reload stale shell inputs before materializing prelude");
  }
  if (
    !txt.includes("for tool in zx-wrapper nix buck2 pnpm git") ||
    !txt.includes('[[ "${missing}" == "0" && -f "${zx_init_path}" ]]')
  ) {
    throw new Error("devshell.sh fast-path must require core toolchain and zx-init to be present");
  }
  if (!txt.includes('BUCK_CONFIG_LOCK=1 exec "$@"')) {
    throw new Error("devshell.sh fast-path must preserve BUCK_CONFIG_LOCK on direct exec");
  }
  if (
    !txt.includes('[[ -f "${cwd_root}/build-tools/tools/dev/viberoots.ts" && -x "${cwd_tool}" ]]')
  ) {
    throw new Error("devshell.sh must only re-exec root build-tools from a viberoots source root");
  }
  if (
    !txt.includes('local prelude_path="${live_root}/.viberoots/workspace/prelude"') ||
    !txt.includes('[[ -f "${prelude_path}/prelude.bzl" ]]') ||
    !txt.includes("ensure_viberoots_current") ||
    !txt.includes('target=".."') ||
    !txt.includes('current_is_live_root="1"') ||
    !txt.includes('[[ "${current_is_live_root}" != "1" && -L "${live_root}/prelude" ]]') ||
    !txt.includes('rm -f "${live_root}/prelude"') ||
    txt.includes('[[ -f "${live_root}/prelude/prelude.bzl" ]]')
  ) {
    throw new Error(
      "devshell.sh must activate .viberoots/current and not materialize root prelude in extracted workspaces",
    );
  }
  if (
    !txt.includes('local selected_viberoots_input_root="${VIBEROOTS_FLAKE_INPUT_ROOT:-') ||
    !txt.includes('! -f "${selected_viberoots_input_root}/flake.nix"') ||
    !txt.includes('export VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}"') ||
    !txt.includes('VIBEROOTS_SOURCE_ROOT="${active_viberoots_root}"') ||
    !txt.includes('VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}" nix build') ||
    !txt.includes('--override-input viberoots "path:${selected_viberoots_input_root}"') ||
    !txt.includes("selected_viberoots_input_hash")
  ) {
    throw new Error(
      "devshell.sh prelude materialization must override and cache by the selected viberoots flake input root",
    );
  }
});
