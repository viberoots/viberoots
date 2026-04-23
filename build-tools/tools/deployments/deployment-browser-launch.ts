#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";

export type BrowserSpawn = typeof spawn;

export function browserLaunchCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export async function launchBrowser(
  url: string,
  opts: { spawnImpl?: BrowserSpawn; settleMs?: number } = {},
): Promise<void> {
  const { command, args } = browserLaunchCommand(url);
  const spawnImpl = opts.spawnImpl || spawn;
  const settleMs = opts.settleMs ?? 1_000;
  let child: ReturnType<BrowserSpawn>;
  try {
    child = spawnImpl(command, args, { stdio: "ignore" });
  } catch (error) {
    throw new Error(
      `browser launch command "${command}" failed: ${String((error as Error)?.message || error)}`,
    );
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => finish(resolve), settleMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      finish(() =>
        reject(
          new Error(
            `browser launch command "${command}" failed: ${String((error as Error)?.message || error)}`,
          ),
        ),
      );
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        finish(resolve);
        return;
      }
      const signalSuffix = signal ? ` (signal ${signal})` : "";
      finish(() =>
        reject(
          new Error(`browser launch command "${command}" exited with code ${code}${signalSuffix}`),
        ),
      );
    });
    child.unref();
  });
}
