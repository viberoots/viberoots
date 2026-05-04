#!/usr/bin/env zx-wrapper
import "zx/globals";
import { getFlagStr } from "../lib/cli";
import { resolveToolPath } from "../lib/tool-paths";
import { ownerPidForIsolation } from "./buck-watchdog-lib";
import * as fsp from "node:fs/promises";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killBuck2dByPid(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 1) return;
  if (!isPidAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function appendLog(logFile: string, line: string): Promise<void> {
  if (!logFile) return;
  await fsp.appendFile(logFile, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

async function tryBuckKillIsolation(iso: string, logFile: string, reason: string): Promise<void> {
  if (!iso) return;
  await appendLog(logFile, `[watchdog] buck2 kill iso=${iso} reason=${reason}`);
  await $({
    stdio: "ignore",
    reject: false,
    nothrow: true,
    timeout: 10_000,
  })`buck2 --isolation-dir ${iso} kill`;
}

async function sweepOrphans(patterns: RegExp, logFile: string, reason: string) {
  try {
    const psPath = await resolveToolPath("ps");
    const { stdout } = await $({ stdio: "pipe" })`${psPath} -A -o pid=,command=`;
    const lines = String(stdout || "").split("\n");
    for (const ln of lines) {
      const pidFromLine = Number((ln.match(/^\s*(\d+)\s+/) || [])[1] || "0");
      // Extract isolation from a running buck2d command line
      const m = ln.match(/--isolation-dir\s+([^\s]+)/);
      if (!m) continue;
      const iso = m[1];
      if (!patterns.test(iso)) continue;
      const ownerPid = ownerPidForIsolation(iso);
      if (!Number.isFinite(ownerPid) || ownerPid == null || isPidAlive(ownerPid)) continue;
      await tryBuckKillIsolation(iso, logFile, `${reason}:owner-pid-${ownerPid}-dead`);
      await new Promise((r) => setTimeout(r, 250));
      await killBuck2dByPid(pidFromLine);
    }
  } catch {}
}

async function main() {
  const parentPid = Number(getFlagStr("parent", "0"));
  const iso = getFlagStr("iso", "");
  const patternsRaw = getFlagStr("patterns", "zxtest-,exporter-,devbuild-");
  const logFile = getFlagStr("log-file", "");
  const sweepWhileParentAlive = getFlagStr("sweep-while-parent-alive", "1") !== "0";
  const pat = new RegExp(
    `^(?:${patternsRaw
      .split(",")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
  );

  if (!Number.isFinite(parentPid) || parentPid <= 1) return;

  while (isPidAlive(parentPid)) {
    if (sweepWhileParentAlive) {
      await sweepOrphans(pat, logFile, "parent-alive-sweep");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Parent exited: kill the main isolation and sweep once more
  if (iso) {
    await tryBuckKillIsolation(iso, logFile, "parent-exited-main-isolation");
  }
  await sweepOrphans(pat, logFile, "parent-exited-sweep");
}

main().catch(() => process.exit(0));
