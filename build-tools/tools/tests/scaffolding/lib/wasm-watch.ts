#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
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

const WORKSPACE_LINK_PREFIXES = ["workspace:", "link:", "file:"];
const perFileTouchStep = new Map<string, number>();

export function isWorkspaceLinkedSpec(spec: string): boolean {
  const normalized = String(spec || "").trim();
  return WORKSPACE_LINK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function assertWorkspaceLinkedDependency(
  deps: Record<string, string> | undefined,
  depName: string,
): void {
  const spec = String(deps?.[depName] || "").trim();
  if (!isWorkspaceLinkedSpec(spec)) {
    throw new Error(
      [
        `[hmr-contract] missing local-link for '${depName}'`,
        "expected dependency spec to use workspace:, link:, or file:",
        "recovery: verify importer dependency uses workspace:, link:, or file:, then restart `pnpm run dev`",
      ].join("\n"),
    );
  }
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
  pollMs = 250,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getter();
      if (check(last)) return last;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `timed out waiting for expected value after ${timeoutMs}ms (last error: ${message})`,
    );
  }
  const rendered = typeof last === "string" ? last : JSON.stringify(last);
  throw new Error(
    `timed out waiting for expected value after ${timeoutMs}ms (last value: ${String(rendered)})`,
  );
}

export async function waitForConsecutive(
  getter: () => Promise<boolean>,
  requiredCount: number,
  timeoutMs = 60000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let consecutive = 0;
  while (Date.now() - start < timeoutMs) {
    const ok = await getter();
    if (ok) {
      consecutive += 1;
      if (consecutive >= requiredCount) return;
    } else {
      consecutive = 0;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `timed out waiting for ${requiredCount} consecutive successes after ${timeoutMs}ms`,
  );
}

export async function writeAndBumpMtime(filePath: string, contents: string): Promise<void> {
  await fsp.writeFile(filePath, contents, "utf8");
  const nextStep = (perFileTouchStep.get(filePath) || 0) + 1;
  perFileTouchStep.set(filePath, nextStep);
  const stamp = new Date(Date.now() + nextStep * 1100);
  await fsp.utimes(filePath, stamp, stamp);
}

export function assertNoProcessRestart(
  child: { pid?: number; exitCode?: number | null },
  expectedPid: number | undefined,
): void {
  if (child.exitCode != null) {
    throw new Error(`[hmr-contract] dev process exited unexpectedly (code=${child.exitCode})`);
  }
  if (expectedPid !== undefined && child.pid !== expectedPid) {
    throw new Error(
      `[hmr-contract] dev process restarted unexpectedly (expected pid ${expectedPid}, got ${String(child.pid)})`,
    );
  }
}

export function assertWatcherFailureContract(logs: string): void {
  if (!logs.includes("[wasm-watch] rebuild:fail")) {
    throw new Error("[hmr-contract] missing watcher failure marker: [wasm-watch] rebuild:fail");
  }
  if (!logs.includes("[wasm-watch] recovery: run this command manually:")) {
    throw new Error(
      "[hmr-contract] missing watcher recovery marker: [wasm-watch] recovery: run this command manually:",
    );
  }
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
