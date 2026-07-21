import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathStartsWithRootVariant } from "../../dev/verify/buck-orphan-cleanup-lib";
import { buck2dProcsForRepo, forkserversUnderRepo } from "./test-helpers/buck-procs";

export type BuckCleanupChildState = ReturnType<typeof observeBuckCleanupChild>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childDiagnostics(state: BuckCleanupChildState): string {
  return `stdout:\n${state.stdout()}\nstderr:\n${state.stderr()}`;
}

function guardedTempRoot(tmp: string, prefix: string): string {
  const resolved = path.resolve(tmp);
  const tmpRoot = path.resolve(process.env.TMPDIR || os.tmpdir());
  assert.ok(
    resolved !== tmpRoot &&
      pathStartsWithRootVariant(resolved, tmpRoot) &&
      path.basename(resolved).startsWith(prefix),
    `refusing to remove unowned child temp repo: ${resolved}`,
  );
  return resolved;
}

export function observeBuckCleanupChild(child: ChildProcess) {
  let tmp = "";
  let stdout = "";
  let stderr = "";
  let ready = false;
  let closed = child.exitCode !== null || child.signalCode !== null;
  let exitCode = child.exitCode;
  let signalCode = child.signalCode;

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
    const match = stdout.match(/(?:KEEP_)?TMP\s+(\S+)/);
    if (match?.[1]) tmp = match[1].trim();
    if (stdout.includes("\nREADY\n") || stdout.trimEnd().endsWith("READY")) ready = true;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("close", (code, signal) => {
    closed = true;
    exitCode = code;
    signalCode = signal;
  });

  return {
    child,
    closed: () => closed,
    exitCode: () => exitCode,
    ready: () => ready,
    signalCode: () => signalCode,
    stderr: () => stderr,
    stdout: () => stdout,
    tmp: () => tmp,
  };
}

export async function waitForBuckCleanupChildReady(
  state: BuckCleanupChildState,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((!state.tmp() || !state.ready()) && !state.closed() && Date.now() < deadline) {
    await sleep(50);
  }
  assert.ok(state.tmp(), `expected child tmp path; ${childDiagnostics(state)}`);
  assert.ok(state.ready(), `expected child READY; ${childDiagnostics(state)}`);
}

export async function waitForBuckCleanupChildClose(
  state: BuckCleanupChildState,
  timeoutMs = 60_000,
): Promise<void> {
  if (state.closed()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`buck cleanup child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    state.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function requestBuckCleanupChildStop(
  state: BuckCleanupChildState,
  prefix = "buck-cleanup-nondisruptive-child-",
): Promise<void> {
  if (!state.tmp()) {
    await killBuckCleanupChild(state);
    throw new Error(`buck cleanup child did not report its temp root; ${childDiagnostics(state)}`);
  }
  const tmp = guardedTempRoot(state.tmp(), prefix);
  if (!state.closed()) await fsp.writeFile(path.join(tmp, "stop.signal"), "stop\n", "utf8");
  await waitForBuckCleanupChildClose(state);
  assert.equal(
    state.exitCode(),
    0,
    `buck cleanup child exited unexpectedly signal=${state.signalCode()}; ${childDiagnostics(state)}`,
  );
  await assert.rejects(fsp.access(tmp));
}

export async function killBuckCleanupChild(
  state: BuckCleanupChildState,
  opts: { requireRunning?: boolean } = {},
): Promise<void> {
  if (state.closed()) {
    if (opts.requireRunning) assert.fail("expected buck cleanup child to still be running");
    return;
  }
  assert.equal(state.child.kill("SIGKILL"), true, "expected SIGKILL delivery to child");
  await waitForBuckCleanupChildClose(state);
  if (opts.requireRunning) {
    assert.equal(state.signalCode(), "SIGKILL", `expected SIGKILL, got ${state.signalCode()}`);
  }
}

async function waitForBuckRepoQuiescent(
  repoRoot: string,
  $: any,
  timeoutMs = 30_000,
  quietMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | undefined;
  let forks: Awaited<ReturnType<typeof forkserversUnderRepo>> = [];
  let daemons: Awaited<ReturnType<typeof buck2dProcsForRepo>> = [];
  while (Date.now() < deadline) {
    [forks, daemons] = await Promise.all([
      forkserversUnderRepo(repoRoot, $),
      buck2dProcsForRepo(repoRoot, $),
    ]);
    if (forks.length === 0 && daemons.length === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else {
      quietSince = undefined;
    }
    await sleep(250);
  }
  throw new Error(
    `buck cleanup repo did not quiesce: ${repoRoot}\n` +
      [...forks, ...daemons].map((proc) => `${proc.pid} ${proc.cmd}`).join("\n"),
  );
}

export async function removeInterruptedBuckCleanupRepo(
  tmp: string,
  $: any,
  prefix = "buck-cleanup-interrupted-",
): Promise<void> {
  const resolved = guardedTempRoot(tmp, prefix);
  await waitForBuckRepoQuiescent(resolved, $);
  await fsp.rm(resolved, { recursive: true, force: true });
  await assert.rejects(fsp.access(resolved));
}
