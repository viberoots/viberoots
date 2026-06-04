#!/usr/bin/env zx-wrapper
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { PROJECT_SHARED_CONFIG_PATH } from "./project-config";

export const DEFAULT_SPRINKLEREF_CONFIG_PATH = PROJECT_SHARED_CONFIG_PATH;

export async function readSelectedSprinkleRefConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const selected = configPath || env.SPRINKLEREF_CONFIG || "";
  try {
    return await readSprinkleRefConfig(selected, cwd);
  } catch (error) {
    throw new Error(configReadErrorMessage(selected || DEFAULT_SPRINKLEREF_CONFIG_PATH, error));
  }
}

function configReadErrorMessage(selected: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (error && typeof error === "object" && "code" in error && error.code === "ENOENT") ||
    /ENOENT/.test(message)
  ) {
    return `Project config not found: ${selected}. Run sprinkleref --init projects/config and edit projects/config/shared.json plus gitignored projects/config/local.json for this environment.`;
  }
  return message;
}
