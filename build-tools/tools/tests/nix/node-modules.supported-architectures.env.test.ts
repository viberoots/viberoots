#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function expectSupportedArchitectureEnv(file: string): Promise<void> {
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("npm_config_supported_architectures_os_0")) {
    throw new Error(`${file} must export pnpm supported os for platform-specific optional deps`);
  }
  if (!txt.includes("npm_config_supported_architectures_cpu")) {
    throw new Error(`${file} must export pnpm supported cpu for platform-specific optional deps`);
  }
  if (!txt.includes("npm_config_supported_architectures_libc")) {
    throw new Error(`${file} must export pnpm supported libc for linux optional deps`);
  }
}

test("pnpm store derivation exports supported architecture env", async () => {
  await expectSupportedArchitectureEnv("build-tools/tools/nix/node-modules/store.nix");
});

test("node-modules derivation exports supported architecture env", async () => {
  await expectSupportedArchitectureEnv("build-tools/tools/nix/node-modules/modules.nix");
});
