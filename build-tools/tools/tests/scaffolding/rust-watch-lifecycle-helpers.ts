import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export async function waitForOutput(
  child: ChildProcess,
  output: () => string,
  expected: RegExp,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (expected.test(output())) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`process exited before ${expected}: ${output()}`);
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${expected}: ${output()}`);
}

export async function waitForOutputCount(
  child: ChildProcess,
  output: () => string,
  expected: RegExp,
  count: number,
): Promise<void> {
  await waitForOutput(child, output, new RegExp(`(?:${expected.source}[\\s\\S]*){${count}}`, "u"));
}

export async function stopWatcher(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    sleep(10_000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
}
