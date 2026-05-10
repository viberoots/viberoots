import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveToolPathSync } from "./tool-paths";

export function watchdogEnvFor(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  delete scrubbed.BUCK_TEST_TARGET;
  delete scrubbed.VBR_VERIFY_LOG_FILE;
  delete scrubbed.VBR_VERIFY_PROCESS_STATE_FILE;
  delete scrubbed.VBR_BUCK_REAPER_STATE_FILE;
  return scrubbed;
}

function executablePath(value: string | undefined): string {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) return "";
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return "";
  }
}

export function resolveWatchdogShell(env: NodeJS.ProcessEnv = process.env): string {
  return (
    executablePath(env.VBR_BASH_BIN) ||
    executablePath(env.BASH) ||
    (() => {
      try {
        return resolveToolPathSync("bash", env);
      } catch {
        return "bash";
      }
    })()
  );
}
