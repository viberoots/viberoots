#!/usr/bin/env zx-wrapper
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { getFlagStr } from "../lib/cli";
import { evaluationBundleDevOverrides } from "./evaluation-bundle-selectors";

type Fingerprint = Map<string, string>;
type WatchChild = Pick<ChildProcess, "pid" | "kill" | "once" | "removeListener">;

export type RustWatchDeps = {
  spawnChild: () => WatchChild;
  signalGroup: (child: WatchChild, signal: NodeJS.Signals) => void;
  wait: (milliseconds: number) => Promise<void>;
  ownerAlive: () => boolean;
  onEvent?: (event: string) => void;
};

const ignored = new Set(["target", ".git", ".viberoots", "buck-out", "node_modules"]);

async function collect(roots: readonly string[]): Promise<Fingerprint> {
  const files = new Map<string, string>();
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (
        entry.isFile() &&
        (entry.name.endsWith(".rs") ||
          entry.name === "Cargo.toml" ||
          entry.name === "Cargo.lock" ||
          entry.name.endsWith(".patch"))
      ) {
        const stat = await fsp.stat(absolute);
        files.set(absolute, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const root of roots) await visit(root);
  return files;
}

function equal(left: Fingerprint, right: Fingerprint): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

async function awaitExit(child: WatchChild, milliseconds: number): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const closed = () => finish(true);
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener("close", closed);
      resolve(exited);
    };
    child.once("close", closed);
    timer = setTimeout(() => finish(false), milliseconds);
  });
}

export async function stopRustWatchChild(
  child: WatchChild | null,
  deps: Pick<RustWatchDeps, "signalGroup">,
  graceMs = 2_000,
): Promise<void> {
  if (!child?.pid) return;
  deps.signalGroup(child, "SIGTERM");
  if (await awaitExit(child, graceMs)) return;
  deps.signalGroup(child, "SIGKILL");
  await awaitExit(child, graceMs);
}

export async function runRustWatch(opts: {
  roots: readonly string[];
  pollMs: number;
  stopGraceMs?: number;
  deps: RustWatchDeps;
  shouldStop: () => boolean;
}): Promise<void> {
  let child: WatchChild | null = null;
  const closeHandlers = new Map<WatchChild, () => void>();
  const detachCloseHandler = (instance: WatchChild) => {
    const handler = closeHandlers.get(instance);
    if (handler) instance.removeListener("close", handler);
    closeHandlers.delete(instance);
  };
  let fingerprint = await collect(opts.roots);
  const restart = async () => {
    const previous = child;
    await stopRustWatchChild(previous, opts.deps, opts.stopGraceMs);
    if (previous) detachCloseHandler(previous);
    if (child === previous) child = null;
    if (opts.shouldStop() || !opts.deps.ownerAlive()) return;
    const instance = opts.deps.spawnChild();
    child = instance;
    opts.deps.onEvent?.("spawn");
    const closeHandler = () => {
      closeHandlers.delete(instance);
      if (child === instance) child = null;
      opts.deps.onEvent?.("close");
    };
    closeHandlers.set(instance, closeHandler);
    instance.once("close", closeHandler);
  };
  await restart();
  try {
    while (!opts.shouldStop() && opts.deps.ownerAlive()) {
      await opts.deps.wait(opts.pollMs);
      const next = await collect(opts.roots);
      if (!equal(fingerprint, next)) {
        fingerprint = next;
        await restart();
      }
    }
  } finally {
    const finalChild = child;
    await stopRustWatchChild(finalChild, opts.deps, opts.stopGraceMs);
    if (finalChild) detachCloseHandler(finalChild);
    child = null;
  }
}

function overrideRoots(workspaceRoot: string, argv: readonly string[]): string[] {
  const overrides = evaluationBundleDevOverrides(argv, {});
  const raw = String(overrides.NIX_RUST_DEV_OVERRIDE_JSON || "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.values(parsed).map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("invalid Rust dev override");
    const root = path.resolve(value);
    if (root === workspaceRoot || root === path.parse(root).root) {
      throw new Error(`Rust watcher override root is too broad: ${root}`);
    }
    return root;
  });
}

async function main() {
  const workspaceRoot = path.resolve(getFlagStr("workspace-root", process.cwd()));
  const target = getFlagStr("target", "");
  const artifactToolsRoot = path.resolve(getFlagStr("artifact-tools-root", ""));
  const toolsFlag = process.argv.indexOf("--artifact-tools-root");
  const passthrough = toolsFlag >= 0 ? process.argv.slice(toolsFlag + 2) : [];
  const pollMs = Math.max(100, Number(getFlagStr("poll-ms", "300")));
  if (!target.startsWith("//")) throw new Error("Rust watcher requires a canonical --target");
  if (!artifactToolsRoot.startsWith("/nix/store/")) {
    throw new Error("Rust watcher requires a Nix-store --artifact-tools-root");
  }
  const packagePath = target.slice(2).split(":")[0] || "";
  const packageRoot = path.resolve(workspaceRoot, packagePath);
  if (!packageRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Rust watcher target escapes the workspace: ${target}`);
  }
  const childRunner = fileURLToPath(new URL("./rust-dev-watch-child.ts", import.meta.url));
  const childWrapper = path.join(artifactToolsRoot, "bin", "zx-wrapper");
  const ownerPid = process.ppid;
  let stopping = false;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const shutdown = () => {
    stopping = true;
  };
  for (const signal of signals) process.once(signal, shutdown);
  try {
    await runRustWatch({
      roots: [packageRoot, ...overrideRoots(workspaceRoot, process.argv.slice(2))],
      pollMs,
      shouldStop: () => stopping,
      deps: {
        ownerAlive: () => process.ppid === ownerPid && process.ppid > 1,
        wait: async (milliseconds) => await sleep(milliseconds),
        signalGroup: (child, signal) => {
          try {
            process.kill(-child.pid!, signal);
          } catch {
            child.kill(signal);
          }
        },
        spawnChild: () =>
          spawn(childWrapper, [childRunner, "--source=path", target, ...passthrough], {
            cwd: workspaceRoot,
            env: process.env,
            stdio: "inherit",
            detached: true,
          }),
        onEvent: (event) => console.error(`[rust-watch] ${event} target=${target}`),
      },
    });
  } finally {
    for (const signal of signals) process.removeListener(signal, shutdown);
  }
}

const invoked = path.resolve(process.argv[1] || "");
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
