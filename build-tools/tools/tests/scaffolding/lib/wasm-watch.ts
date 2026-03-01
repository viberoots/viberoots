#!/usr/bin/env zx-wrapper
import { setTimeout as sleep } from "node:timers/promises";

export function esbuildPackageName(): string {
  const { platform, arch } = process;
  if (platform === "darwin")
    return arch === "arm64" ? "@esbuild/darwin-arm64" : "@esbuild/darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "@esbuild/linux-arm64" : "@esbuild/linux-x64";
  if (platform === "win32") return arch === "arm64" ? "@esbuild/win32-arm64" : "@esbuild/win32-x64";
  return "";
}

export function producerByteLength(payload: string): number {
  return Buffer.byteLength(`wasm-producer:${payload}`, "utf8");
}

export function assertSingleQueueInvariant(logs: string): void {
  const lines = logs.split(/\r?\n/).filter(Boolean);
  let active = 0;
  for (const line of lines) {
    if (!line.includes("[wasm-watch]")) continue;
    if (line.includes("rebuild:start")) {
      active += 1;
      if (active > 1) throw new Error(`detected overlapping wasm-watch rebuilds: ${line}`);
    }
    if (line.includes("sync:ok") || line.includes("rebuild:fail")) {
      active = Math.max(0, active - 1);
    }
  }
}

export async function waitForValue<T>(
  getter: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 60000,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await getter();
    if (check(last)) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for expected value after ${timeoutMs}ms`);
}

export async function waitForHmrConnected(ws: WebSocket, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`vite hmr websocket did not connect within ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data || "{}")) as { type?: string };
        if (data.type === "connected") {
          clearTimeout(timer);
          resolve();
        }
      } catch {}
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("vite hmr websocket error before connected event"));
    });
  });
}

export async function captureHmrMutationEventsDuring(
  ws: WebSocket,
  timeoutMs: number,
  mutate: () => Promise<void>,
): Promise<{ sawUpdate: boolean; sawFullReload: boolean }> {
  return await new Promise((resolve, reject) => {
    let sawUpdate = false;
    let sawFullReload = false;
    const onMessage = (event: any) => {
      try {
        const data = JSON.parse(String(event.data || "{}")) as { type?: string };
        if (data.type === "update") sawUpdate = true;
        if (data.type === "full-reload") sawFullReload = true;
      } catch {}
    };
    const onError = () => {
      cleanup();
      reject(new Error("vite hmr websocket error while waiting for mutation events"));
    };
    const cleanup = () => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ sawUpdate, sawFullReload });
    }, timeoutMs);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    mutate().catch((error) => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
  });
}
