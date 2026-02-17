#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("_env.sh supports safe direnv bypass fast-path", async () => {
  const txt = await fsp.readFile("build-tools/tools/bin/_env.sh", "utf8");
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
});
