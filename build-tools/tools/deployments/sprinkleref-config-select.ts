#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { readSprinkleRefConfig } from "./sprinkleref-config";

export const DEFAULT_SPRINKLEREF_CONFIG_PATH = "config/sprinkleref/selected.json";
const LEGACY_SPRINKLEREF_CONFIG_PATH = "config/sprinkleref/selected.local.json";

export async function readSelectedSprinkleRefConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const selected =
    configPath || env.SPRINKLEREF_CONFIG || (await existingDefaultConfigPath()) || "";
  if (!selected) throw new Error("missing SprinkleRef config; pass --config or SPRINKLEREF_CONFIG");
  try {
    return await readSprinkleRefConfig(selected);
  } catch (error) {
    throw new Error(configReadErrorMessage(selected, error));
  }
}

async function existingDefaultConfigPath() {
  for (const configPath of [DEFAULT_SPRINKLEREF_CONFIG_PATH, LEGACY_SPRINKLEREF_CONFIG_PATH]) {
    if ((await fs.stat(configPath).catch(() => undefined))?.isFile()) return configPath;
  }
  return "";
}

function configReadErrorMessage(selected: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (error && typeof error === "object" && "code" in error && error.code === "ENOENT") ||
    /ENOENT/.test(message)
  ) {
    return `SprinkleRef resolver config not found: ${selected}. Run build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, then build-tools/tools/deployments/infisical-bootstrap.ts repo (or add --yes to skip the prompt), or run sprinkleref --init config/sprinkleref and edit the generated config for this environment. Then retry with --config ${selected}.`;
  }
  return message;
}
