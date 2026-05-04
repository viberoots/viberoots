#!/usr/bin/env zx-wrapper
import process from "node:process";
import timers from "node:timers";
import { getArgvTokens, removeKnownFlags } from "../lib/cli";
import { runManagedCommand, type ManagedCommandActivity } from "../lib/managed-command";

type Options = {
  prefix: string;
  label: string;
  cwd: string;
  timeoutMs: number;
  noOutputWarnSec: number;
  command: string;
  args: string[];
};

function usage(): never {
  throw new Error(
    "usage: command-heartbeat.ts --label <label> [--prefix <prefix>] [--cwd <cwd>] [--timeout-ms <ms>] [--no-output-warn-sec <sec>] -- <command> [args...]",
  );
}

function parsePositiveInt(raw: string, fallback: number): number {
  const parsed = Number(raw || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs(): Options {
  const argv = getArgvTokens();
  const split = argv.indexOf("--");
  if (split < 0) usage();
  const flags = argv.slice(0, split);
  const commandArgs = argv.slice(split + 1).filter((token) => String(token || "").trim() !== "");
  const { argv: leftover, seen } = removeKnownFlags(flags, {
    presence: [],
    takesValue: ["--label", "--prefix", "--cwd", "--timeout-ms", "--no-output-warn-sec"],
  });
  if (leftover.length !== 0) usage();

  const label = String(seen["--label"] || "").trim();
  if (!label || commandArgs.length === 0) usage();

  const prefix = String(seen["--prefix"] || "").trim() || "[command-heartbeat]";
  const cwd = String(seen["--cwd"] || "").trim() || process.cwd();
  const timeoutMs = parsePositiveInt(String(seen["--timeout-ms"] || ""), 0);
  const noOutputWarnSec = parsePositiveInt(String(seen["--no-output-warn-sec"] || ""), 60);
  return {
    prefix,
    label,
    cwd,
    timeoutMs,
    noOutputWarnSec,
    command: commandArgs[0] || "",
    args: commandArgs.slice(1),
  };
}

function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startHeartbeat(
  opts: Pick<Options, "prefix" | "label" | "noOutputWarnSec">,
  activity: ManagedCommandActivity,
): NodeJS.Timeout {
  const started = Date.now();
  const thresholds = [15, 30, 60, 120, 240, 480, 900];
  let lastBytes = -1;
  let lastNoOutputBucket = -1;
  return timers.setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const now = Date.now();
    const lastAt = activity.lastOutputAtMs || activity.startedAtMs || started;
    const silentForSec = Math.max(0, Math.floor((now - lastAt) / 1000));
    const bytes = activity.stdoutBytes + activity.stderrBytes;
    const childPid = Number(activity.childPid || 0);
    const childAlive = isAlive(childPid);
    if (bytes > lastBytes) {
      lastBytes = bytes;
      const last = activity.lastEventSnippet || "<activity>";
      process.stderr.write(
        `${opts.prefix} phase=${opts.label} elapsed=${elapsed}s status=progress child_pid=${childPid} child_alive=${childAlive} bytes=${bytes} last_event_ago=${silentForSec}s last_event="${last}"\n`,
      );
      return;
    }
    let bucket = 0;
    for (const threshold of thresholds) {
      if (silentForSec >= threshold) bucket = threshold;
    }
    if (bucket <= lastNoOutputBucket) return;
    lastNoOutputBucket = bucket;
    const stall = silentForSec >= opts.noOutputWarnSec ? " no_output_window_exceeded=true" : "";
    process.stderr.write(
      `${opts.prefix} phase=${opts.label} elapsed=${elapsed}s status=waiting-for-output child_pid=${childPid} child_alive=${childAlive} bytes=${bytes} no_output_for=${silentForSec}s${stall}\n`,
    );
  }, 15000);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const activity: ManagedCommandActivity = {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  const timer = startHeartbeat(opts, activity);
  try {
    const result = await runManagedCommand({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      env: process.env,
      timeoutMs: opts.timeoutMs,
      activity,
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (result.ok) return;
    const reason = result.timedOut
      ? `timed out after ${Math.max(1, Math.ceil(opts.timeoutMs / 1000))}s`
      : `failed (code=${String(result.code)} signal=${String(result.signal)})`;
    process.stderr.write(`${opts.prefix} phase=${opts.label} ${reason}\n`);
    process.exit(result.timedOut ? 124 : (result.code ?? 1));
  } finally {
    timers.clearInterval(timer);
  }
}

await main();
