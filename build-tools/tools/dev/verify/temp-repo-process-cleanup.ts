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

function isScopedTempDevProcess(cmd: string): boolean {
  const c = String(cmd || "");
  if (c.includes("buck2d[") || c.includes("(buck2-forkserver)")) return false;
  if (c.includes("/esbuild") && c.includes("--service=")) return true;
  if (c.includes("vite/bin/vite.js")) return true;
  if (c.includes("next/dist/bin/next") && c.includes(" dev")) return true;
  if (c.includes("next-server")) return true;
  if (c.includes("watch-wasm-producer.ts")) return true;
  if (c.includes("wasm-watch-coordinator-daemon.ts")) return true;
  if (c.includes("dev-with-wasm-watch.ts")) return true;
  if (c.includes("/scripts/dev-wasm-watch.mjs")) return true;
  if (c.includes("pnpm exec vite")) return true;
  if (c.includes("pnpm run dev:ssr:only")) return true;
  if (c.includes("pnpm run dev:wasm:watch")) return true;
  if (c.includes("/server/dev.mjs")) return true;
  return false;
}

type Proc = { pid: number; etime: string; cmd: string };

function collectScopedProcesses(lines: string[], roots: string[]): Proc[] {
  const out: Proc[] = [];
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
    out.push({ pid: p.pid, etime: p.etime, cmd: p.cmd });
  }
  return out;
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
      child.on("error", () => resolve([]));
      child.on("close", () => {
        resolve(
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
  const lines = [...(await psLines(2000)), ...(await pgrepScopedProcessLines(roots))];
  const procs = collectScopedProcesses(lines, roots);
  const capped = procs.slice(0, maxKills);
  const pids = capped.map((p) => p.pid);
  await signalPids(pids, "SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  await signalPids(pids, "SIGKILL");
  let killed = 0;
  for (const pid of pids) {
    if (!isPidAlive(pid)) killed++;
  }
  if (opts.log) {
    for (const p of capped) {
      await opts.log(
        `[verify] temp-repo process cleanup: pid=${p.pid} etime=${p.etime} cmd=${p.cmd.slice(0, 220)}`,
      );
    }
  }
  return { scanned: lines.length, candidates: procs.length, killed };
}
