#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { renderNixosSharedHostConfig } from "./nixos-shared-host";
import { readNixosSharedHostPlatformStateOrEmpty, writeJsonDocument } from "./nixos-shared-host-io";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

async function main() {
  const statePath = requireFlag("state");
  const outPath = requireFlag("out");
  const state = await readNixosSharedHostPlatformStateOrEmpty(statePath);
  await writeJsonDocument(outPath, renderNixosSharedHostConfig(state));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
