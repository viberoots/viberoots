import { type ManagedCommandActivity } from "../../lib/managed-command.ts";

export function newManagedCommandActivity(): ManagedCommandActivity {
  return {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
}
