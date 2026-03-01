#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getFlagStr } from "../lib/cli.ts";
import { runManagedCommand } from "../lib/managed-command.ts";

type Fingerprint = { mtimeMs: number; size: number };

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function fileFingerprint(absPath: string): Promise<Fingerprint> {
  try {
    const st = await fsp.stat(absPath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { mtimeMs: 0, size: -1 };
  }
}

async function computeFingerprintMap(paths: string[]): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  for (const p of paths) out.set(p, await fileFingerprint(p));
  return out;
}

function mapsEqual(a: Map<string, Fingerprint>, b: Map<string, Fingerprint>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a.entries()) {
    const bv = b.get(k);
    if (!bv) return false;
    if (av.mtimeMs !== bv.mtimeMs || av.size !== bv.size) return false;
  }
  return true;
}

function required(name: string, value: string): string {
  const v = String(value || "").trim();
  if (!v) throw new Error(`missing required flag --${name}`);
  return v;
}

async function copyAtomically(src: string, dst: string): Promise<number> {
  const srcStat = await fsp.stat(src);
  const dstDir = path.dirname(dst);
  await fsp.mkdir(dstDir, { recursive: true });
  const tmp = path.join(dstDir, `.${path.basename(dst)}.tmp-${process.pid}-${Date.now()}`);
  await fsp.copyFile(src, tmp);
  await fsp.rename(tmp, dst);
  return srcStat.size;
}

async function runBuildStep(buildCommand: string, cwd: string): Promise<void> {
  const result = await runManagedCommand({
    command: "/bin/bash",
    args: ["--noprofile", "--norc", "-lc", buildCommand],
    cwd,
    env: process.env,
    timeoutMs: 10 * 60 * 1000,
  });
  if (!result.ok) {
    const stderrTail = String(result.stderr || "").slice(-4000);
    const stdoutTail = String(result.stdout || "").slice(-2000);
    throw new Error(
      [
        `build command failed (code=${String(result.code)} signal=${String(result.signal)})`,
        stderrTail ? `stderr tail:\n${stderrTail}` : "",
        stdoutTail ? `stdout tail:\n${stdoutTail}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const watchRaw = required("watch", getFlagStr("watch", ""));
  const watchPaths = splitList(watchRaw).map((p) => path.resolve(cwd, p));
  if (watchPaths.length === 0) throw new Error("at least one --watch path is required");
  const buildCommand = required("build-cmd", getFlagStr("build-cmd", ""));
  const buildOut = path.resolve(cwd, required("build-out", getFlagStr("build-out", "")));
  const syncOut = path.resolve(cwd, required("sync-out", getFlagStr("sync-out", "")));
  const pollMs = Math.max(100, Number(getFlagStr("poll-ms", "300")));

  let running = false;
  let pending = false;
  let pendingReason = "startup";
  let buildSeq = 0;
  let overlapCount = 0;

  const queueBuild = (reason: string) => {
    pending = true;
    pendingReason = reason;
  };

  const runQueuedBuilds = async () => {
    if (running) {
      overlapCount += 1;
      return;
    }
    running = true;
    try {
      while (pending) {
        pending = false;
        buildSeq += 1;
        const seq = buildSeq;
        const reason = pendingReason;
        const startedAt = Date.now();
        console.error(`[wasm-watch] rebuild:start seq=${seq} reason=${reason}`);
        try {
          await runBuildStep(buildCommand, cwd);
          const copiedSize = await copyAtomically(buildOut, syncOut);
          const elapsed = Date.now() - startedAt;
          console.error(
            `[wasm-watch] sync:ok seq=${seq} bytes=${copiedSize} elapsed_ms=${elapsed} out=${syncOut}`,
          );
        } catch (err) {
          const elapsed = Date.now() - startedAt;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[wasm-watch] rebuild:fail seq=${seq} elapsed_ms=${elapsed}`);
          console.error(msg);
          console.error(`[wasm-watch] recovery: run this command manually:\n${buildCommand}`);
        }
      }
    } finally {
      running = false;
    }
  };

  console.error(`[wasm-watch] start watch_count=${watchPaths.length} poll_ms=${pollMs}`);
  queueBuild("startup");
  await runQueuedBuilds();

  let prev = await computeFingerprintMap(watchPaths);
  for (;;) {
    await sleep(pollMs);
    const next = await computeFingerprintMap(watchPaths);
    if (!mapsEqual(prev, next)) {
      prev = next;
      queueBuild("source-change");
      await runQueuedBuilds();
    }
    if (overlapCount > 0) {
      console.error(`[wasm-watch] queue:coalesced count=${overlapCount}`);
      overlapCount = 0;
    }
  }
}

main().catch((err) => {
  console.error("[wasm-watch] fatal");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
