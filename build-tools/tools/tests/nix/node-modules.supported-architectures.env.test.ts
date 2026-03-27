#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function expectSupportedArchitectureEnv(file: string): Promise<void> {
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("supportedArchitectures:")) {
    throw new Error(`${file} must write pnpm supported architectures for optional platform deps`);
  }
  if (!txt.includes('"  os:"')) {
    throw new Error(`${file} must declare pnpm supported os for platform-specific optional deps`);
  }
  if (!txt.includes('"  cpu:"')) {
    throw new Error(`${file} must declare pnpm supported cpu for platform-specific optional deps`);
  }
  if (!txt.includes('"  libc:"')) {
    throw new Error(`${file} must declare pnpm supported libc for linux optional deps`);
  }
}

test("pnpm store derivation writes supported architecture config", async () => {
  await expectSupportedArchitectureEnv("build-tools/tools/nix/node-modules/store.nix");
});

test("node-modules derivation writes supported architecture config", async () => {
  await expectSupportedArchitectureEnv("build-tools/tools/nix/node-modules/modules.nix");
});
