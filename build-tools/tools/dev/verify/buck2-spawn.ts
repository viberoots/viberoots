import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export function spawnBuck2WithTimeout(opts: {
  timeoutPath: string;
  overallTimeoutSecs: number;
  buck2Path: string;
  buckArgs: string[];
  root: string;
  env: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
}): ChildProcess {
  return (opts.spawnImpl || spawn)(
    opts.timeoutPath,
    ["-k", "10s", `${opts.overallTimeoutSecs}s`, opts.buck2Path, ...opts.buckArgs],
    {
      cwd: opts.root,
      env: opts.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as ChildProcess;
}
