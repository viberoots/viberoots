#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readRepoFile(rel: string): Promise<string> {
  for (const candidate of [rel, path.join("viberoots", rel)]) {
    try {
      return await fsp.readFile(candidate, "utf8");
    } catch {}
  }
  return await fsp.readFile(rel, "utf8");
}

test("_env.sh supports safe direnv bypass fast-path", async () => {
  const txt = await readRepoFile("build-tools/tools/bin/_env.sh");
  if (!txt.includes("BUCK_DEV_SHELL_FASTPATH")) {
    throw new Error("_env.sh must expose BUCK_DEV_SHELL_FASTPATH toggle");
  }
  if (!txt.includes("can_bypass_direnv")) {
    throw new Error("_env.sh must compute explicit direnv bypass eligibility");
  }
  if (
    !txt.includes("for tool in zx-wrapper nix buck2 pnpm git") ||
    !txt.includes('[[ "${missing}" == "0" && -f "${zx_init_path}" ]]')
  ) {
    throw new Error("_env.sh fast-path must require core toolchain and zx-init to be present");
  }
  if (!txt.includes('BUCK_CONFIG_LOCK=1 exec "$@"')) {
    throw new Error("_env.sh fast-path must preserve BUCK_CONFIG_LOCK on direct exec");
  }
  if (
    !txt.includes('[[ -f "${live_root}/.viberoots/current/prelude/prelude.bzl" ]]') ||
    !txt.includes("ensure_viberoots_current") ||
    !txt.includes('target=".."') ||
    !txt.includes('current_is_live_root="1"') ||
    !txt.includes('[[ "${current_is_live_root}" != "1" && -L "${live_root}/prelude" ]]') ||
    !txt.includes('rm -f "${live_root}/prelude"') ||
    txt.includes('[[ -f "${live_root}/prelude/prelude.bzl" ]]')
  ) {
    throw new Error(
      "_env.sh must activate .viberoots/current and not materialize root prelude in extracted workspaces",
    );
  }
  if (
    !txt.includes('local selected_viberoots_input_root="${VIBEROOTS_FLAKE_INPUT_ROOT:-') ||
    !txt.includes('! -f "${selected_viberoots_input_root}/flake.nix"') ||
    !txt.includes('export VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}"') ||
    !txt.includes('VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}" nix build') ||
    !txt.includes('--override-input viberoots "path:${selected_viberoots_input_root}"') ||
    !txt.includes("selected_viberoots_input_hash")
  ) {
    throw new Error(
      "_env.sh prelude materialization must override and cache by the selected viberoots flake input root",
    );
  }
});
