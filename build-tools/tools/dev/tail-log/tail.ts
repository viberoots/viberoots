import { spawn } from "node:child_process";
import process from "node:process";
import { resolvePid } from "./resolve";
import type { Resolution } from "./resolve";

export async function followLatestTail(
  resolveLatest: () => Promise<Resolution>,
  lines?: number,
): Promise<void> {
  let tail: ReturnType<typeof spawn> | null = null;
  let currentLog: string | null = null;

  const killTail = async () => {
    if (!tail) return;
    tail.kill("SIGTERM");
    await new Promise<void>((resolve) => tail?.once("exit", () => resolve()));
    tail = null;
  };

  process.on("exit", () => void killTail().catch(() => {}));
  process.on("SIGINT", () => process.exit(130));

  while (true) {
    const res = await resolveLatest();
    if (!res.logPath) {
      process.stderr.write(`error: ${res.error}\n`);
      process.exit(2);
    }
    if (res.logPath !== currentLog) {
      currentLog = res.logPath;
      await killTail();
      if (lines !== undefined) {
        const p = spawn("tail", ["-n", String(lines), currentLog], { stdio: "inherit" });
        const code = await new Promise<number>((resolve) => p.once("exit", (c) => resolve(c ?? 1)));
        process.exit(code);
      }
      tail = spawn("tail", ["-f", currentLog], { stdio: "inherit" });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function tailPidLog(pid: number, lines?: number): Promise<void> {
  const res = await resolvePid(pid);
  if (!res.logPath) {
    process.stderr.write(`error: ${res.error}\n`);
    process.exit(2);
    return;
  }
  const p =
    lines !== undefined
      ? spawn("tail", ["-n", String(lines), res.logPath], { stdio: "inherit" })
      : spawn("tail", ["-f", res.logPath], { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => p.once("exit", (c) => resolve(c ?? 1)));
  process.exit(code);
}
