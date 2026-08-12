import { spawn } from "node:child_process";
import path from "node:path";
import { isPidAlive, parsePsLine, psLines } from "./buck-orphan-cleanup-lib";
import { resolveToolPathSync } from "../../lib/tool-paths";

function normalizeRoot(p: string): string {
  return path.resolve(String(p || "").trim()).replace(/\/+$/, "");
}

function rootVariants(root: string): string[] {
  const base = normalizeRoot(root);
  if (!base) return [];
  if (base.startsWith("/private/")) return [base, base.replace(/^\/private/, "")];
  if (base.startsWith("/var/") || base.startsWith("/tmp/")) return [base, `/private${base}`];
  return [base];
}

function commandContainsRoot(cmd: string, root: string): boolean {
  const c = String(cmd || "");
  const r = normalizeRoot(root);
  if (!r) return false;
  return c.includes(r + "/") || c.includes(`${r} `) || c.endsWith(r);
}

export function isScopedTempDevProcess(cmd: string): boolean {
  const c = String(cmd || "");
  if (c.includes("buck2d[") || c.includes("(buck2-forkserver)")) return false;
  if (c.includes("/esbuild") && c.includes("--service=")) return true;
  if (c.includes("vite/bin/vite.js")) return true;
  if (c.includes("next/dist/bin/next") && c.includes(" dev")) return true;
  if (c.includes("next-server")) return true;
  if (c.includes("watch-wasm-producer.ts")) return true;
  if (c.includes("watch-wasm-coordinator.ts")) return true;
  if (c.includes("wasm-watch-coordinator-daemon.ts")) return true;
  if (c.includes("dev-with-wasm-watch.ts")) return true;
  if (c.includes("run-runnable.ts") && c.includes("--mode dev")) return true;
  if (c.includes("/scripts/dev.ts")) return true;
  if (c.includes("/scripts/dev-wasm-watch.mjs")) return true;
  if (c.includes("/scripts/dev-wasm-watch.ts")) return true;
  if (c.includes("tail-log.ts") && c.includes("--status") && c.includes("-w")) return true;
  if (c.includes("pnpm exec vite")) return true;
  if (c.includes("pnpm run dev:ssr:only")) return true;
  if (c.includes("pnpm run dev:wasm:watch")) return true;
  if (c.includes("/server/dev.mjs")) return true;
  return false;
}

type Proc = { pid: number; etime: string; cmd: string };

const CLEANUP_SETTLE_TIMEOUT_MS = 10_000;
const CLEANUP_POLL_MS = 100;

function collectScopedProcesses(lines: string[], roots: string[]): Proc[] {
  const out: Proc[] = [];
  const seenPids = new Set<number>();
  const rootSet = new Set(
    roots
      .map((r) => rootVariants(r))
      .flat()
      .filter(Boolean),
  );
  for (const ln of lines) {
    const p = parsePsLine(ln);
    if (!p) continue;
    if (p.pid <= 1 || p.pid === process.pid) continue;
    if (!isScopedTempDevProcess(p.cmd)) continue;
    let owned = false;
    for (const r of rootSet) {
      if (commandContainsRoot(p.cmd, r)) {
        owned = true;
        break;
      }
    }
    if (!owned) continue;
    if (seenPids.has(p.pid)) continue;
    seenPids.add(p.pid);
    out.push({ pid: p.pid, etime: p.etime, cmd: p.cmd });
  }
  return out;
}

async function scanScopedProcesses(roots: string[]): Promise<{ lines: string[]; procs: Proc[] }> {
  const lines = [...(await psLines(2000)), ...(await pgrepScopedProcessLines(roots))];
  return { lines, procs: collectScopedProcesses(lines, roots) };
}

async function pgrepScopedProcessLines(roots: string[]): Promise<string[]> {
  let pgrepPath = "";
  try {
    pgrepPath = resolveToolPathSync("pgrep");
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const root of roots.flatMap((r) => rootVariants(r))) {
    const pattern = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = await new Promise<string[]>((resolve) => {
      let child;
      let settled = false;
      const finish = (value: string[]) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        child = spawn(pgrepPath, ["-afil", pattern], {
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        resolve([]);
        return;
      }
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => (buf += d));
      child.on("error", () => finish([]));
      child.on("close", () => {
        finish(
          String(buf || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .flatMap((line) => {
              const match = line.match(/^(\d+)\s+(.*)$/);
              if (!match) return [];
              const pid = Number(match[1]);
              const cmd = String(match[2] || "").trim();
              if (!Number.isFinite(pid) || pid <= 1) return [];
              if (!cmd.includes(root)) return [];
              if (cmd.includes("pgrep -afil")) return [];
              return [`${pid} 0 00:00 ${cmd}`];
            }),
        );
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish([]);
      }, 2000);
      child.on("close", () => clearTimeout(timer));
    });
    lines.push(...next);
  }
  return Array.from(new Set(lines));
}

async function signalPids(pids: number[], sig: NodeJS.Signals): Promise<number> {
  let sent = 0;
  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, sig);
      sent++;
    } catch {}
  }
  return sent;
}

export async function cleanupTempRepoProcesses(opts: {
  roots: string[];
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const roots = Array.from(
    new Set((opts.roots || []).map((r) => normalizeRoot(r)).filter(Boolean)),
  );
  if (roots.length === 0) return { scanned: 0, candidates: 0, killed: 0 };
  const maxKills = Math.max(0, opts.maxKills ?? 500);
  const deadline = Date.now() + CLEANUP_SETTLE_TIMEOUT_MS;
  const candidates = new Map<number, Proc>();
  let scanned = 0;
  let stableEmptyScans = 0;
  while (Date.now() < deadline && stableEmptyScans < 2) {
    const scan = await scanScopedProcesses(roots);
    scanned += scan.lines.length;
    const next = scan.procs.filter((proc) => !candidates.has(proc.pid));
    if (scan.procs.length === 0) {
      stableEmptyScans++;
    } else {
      stableEmptyScans = 0;
    }
    const capped = next.slice(0, maxKills - candidates.size);
    for (const proc of capped) candidates.set(proc.pid, proc);
    const pids = capped.map((proc) => proc.pid);
    if (pids.length > 0) {
      await signalPids(pids, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await signalPids(pids, "SIGKILL");
    }
    await new Promise((resolve) => setTimeout(resolve, CLEANUP_POLL_MS));
  }
  const procs = Array.from(candidates.values());
  const pids = procs.map((proc) => proc.pid);
  const killed = pids.filter((pid) => !isPidAlive(pid)).length;
  if (opts.log) {
    for (const p of procs) {
      await opts.log(
        `[verify] temp-repo process cleanup: pid=${p.pid} etime=${p.etime} cmd=${p.cmd.slice(0, 220)}`,
      );
    }
  }
  return { scanned, candidates: procs.length, killed };
}
