import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { ensureNixStoreToolPathSync, isNixStorePath } from "../lib/tool-paths";
import { normalizeTargetLabel, parseLockfileLabel } from "../lib/labels";
import {
  findRunnableEntryForTarget,
  readRunnableManifest,
  type RunnableManifestEntry,
} from "../lib/runnables";
export { resolveRunnableTargetLabel } from "./target-label-resolver";

export function parseArgs(argv: string[]): {
  mode: "prod" | "dev";
  target: string;
  passthrough: string[];
  sourceMode: "auto" | "git" | "path";
  sourceError?: string;
} {
  let mode: "prod" | "dev" = "prod";
  let sourceMode: "auto" | "git" | "path" = "auto";
  let sourceError: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || "");
    if (tok === "--mode" && i + 1 < argv.length) {
      const m = String(argv[i + 1] || "").trim();
      if (m === "prod" || m === "dev") mode = m;
      i++;
      continue;
    }
    if (tok.startsWith("--mode=")) {
      const m = tok.slice("--mode=".length).trim();
      if (m === "prod" || m === "dev") mode = m;
      continue;
    }
    if (tok === "--source" && i + 1 < argv.length) {
      const s = String(argv[i + 1] || "").trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      i++;
      continue;
    }
    if (tok.startsWith("--source=")) {
      const s = tok.slice("--source=".length).trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      continue;
    }
    rest.push(tok);
  }
  const target = String(rest[0] || "").trim();
  return { mode, target, passthrough: rest.slice(1), sourceMode, sourceError };
}

export async function importerForTarget(workspaceRoot: string, target: string): Promise<string> {
  const hints = await runnableHintsForTarget(workspaceRoot, target);
  return hints.importer;
}

export async function runnableHintsForTarget(
  workspaceRoot: string,
  target: string,
): Promise<{ importer: string; mode: "static" | "ssr"; framework: string }> {
  const fallback = { importer: "", mode: "static" as const, framework: "" };
  try {
    const graphTxt = await fsp.readFile(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "utf8");
    const raw = JSON.parse(graphTxt);
    const nodes = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
    const want = normalizeTargetLabel(target);
    for (const n of nodes) {
      const name = normalizeTargetLabel(String(n?.name || ""));
      if (name !== want) continue;
      const labels = Array.isArray(n?.labels) ? n.labels : [];
      let importer = "";
      let mode: "static" | "ssr" = "static";
      let framework = "";
      for (const label of labels) {
        const parsed = parseLockfileLabel(String(label || ""));
        if (parsed?.importer) importer = parsed.importer;
        const value = String(label || "");
        if (value === "webapp:ssr") mode = "ssr";
        if (value === "framework:express") framework = "express";
        if (value === "framework:next") framework = "next";
        if (value === "framework:vite") framework = "vite";
        if (value === "framework:hatch") framework = "hatch";
      }
      return { importer, mode, framework };
    }
  } catch {}
  return fallback;
}

export async function readManifestEntry(
  manifestPath: string,
  target: string,
): Promise<RunnableManifestEntry | null> {
  try {
    const entries = await readRunnableManifest(manifestPath);
    return findRunnableEntryForTarget(entries, target);
  } catch {
    return null;
  }
}

function signalChildGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

export async function runCommand(argv: string[], extra: string[], cwd?: string): Promise<number> {
  let cmd = String(argv[0] || "").trim();
  if (!cmd) return 2;
  const tool = path.basename(cmd);
  if (["python", "python3", "uv"].includes(tool)) {
    if (cmd === tool) {
      cmd = ensureNixStoreToolPathSync(tool);
    } else if (!isNixStorePath(cmd)) {
      throw new Error(`runnable tool must resolve to /nix/store: ${tool} -> ${cmd}`);
    }
  }
  const args = [...argv.slice(1), ...extra];
  const child = spawn(cmd, args, {
    cwd: cwd || process.cwd(),
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  let stopping = false;
  let forcedKillTimer: NodeJS.Timeout | null = null;
  const forwardSignal = (signal: NodeJS.Signals) => {
    stopping = true;
    signalChildGroup(child, signal);
    if (!forcedKillTimer) {
      forcedKillTimer = setTimeout(() => signalChildGroup(child, "SIGKILL"), 10_000);
      forcedKillTimer.unref?.();
    }
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  process.once("SIGHUP", () => forwardSignal("SIGHUP"));
  return await new Promise<number>((resolve) => {
    child.once("close", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      process.off("SIGHUP", forwardSignal);
      if (forcedKillTimer) clearTimeout(forcedKillTimer);
      if (typeof code === "number") resolve(code);
      else if (stopping && signal === "SIGINT") resolve(130);
      else if (stopping && signal) resolve(143);
      else resolve(signal ? 130 : 1);
    });
    child.once("error", () => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      process.off("SIGHUP", forwardSignal);
      if (forcedKillTimer) clearTimeout(forcedKillTimer);
      resolve(1);
    });
  });
}
