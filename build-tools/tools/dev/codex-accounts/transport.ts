import * as fsp from "node:fs/promises";

import type { WrapperPlan } from "./types";

function pair(parts: string[], key: string, value: string): void {
  parts.push(key, value);
}

export async function writeWrapperPlan(file: string, plan: WrapperPlan): Promise<void> {
  const parts: string[] = [];
  pair(parts, "action", plan.action);
  if (plan.action === "exit") {
    pair(parts, "exit-code", String(plan.exitCode));
  } else if (plan.action === "reexec") {
    for (const arg of plan.args) pair(parts, "reexec-arg", arg);
  } else {
    if (plan.codexHome !== null) pair(parts, "codex-home", plan.codexHome);
    for (const arg of plan.args) pair(parts, "arg", arg);
    for (const arg of plan.reexecPrefix) pair(parts, "worktree-reexec-arg", arg);
  }
  await fsp.writeFile(file, Buffer.from(parts.join("\0") + "\0", "utf8"), { mode: 0o600 });
}
