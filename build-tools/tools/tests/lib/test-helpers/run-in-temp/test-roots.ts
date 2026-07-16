import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../../../lib/macos-metadata";

const preNoindexStableRootCleanup = new Set<string>();
const TEST_HOME_ACTIVE_PID_FILE = ".viberoots-test-home-pid";
const TEST_HOME_UNMARKED_STALE_MS = 60 * 60 * 1000;
const TEST_HOME_UNMARKED_MAX_COUNT = 256;
let stableTestHomeRootCleanupOnce: Promise<void> | null = null;
const stableTestHomeExitCleanup = new Set<string>();
let stableTestHomeOnce: Promise<string> | null = null;
export async function removeDarwinPreNoindexStableRoot(root: string): Promise<void> {
  if (process.platform !== "darwin" || !root.endsWith(".noindex")) return;
  const preNoindexRoot = root.slice(0, -".noindex".length);
  if (preNoindexStableRootCleanup.has(preNoindexRoot)) return;
  preNoindexStableRootCleanup.add(preNoindexRoot);
  await fsp.rm(preNoindexRoot, { recursive: true, force: true }).catch(() => {});
}

export async function stableTestHomeRoot(): Promise<string> {
  // Keep per-test HOME outside repo-local TMPDIR to avoid flake input churn and rsync/nix races
  // caused by transient tool caches (e.g. pnpm metadata temp files).
  if (process.platform === "win32") return os.tmpdir();
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-test-home${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  await cleanupStableTestHomesOnce(root);
  return root;
}

export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function activeTestHomePid(home: string): Promise<number | null> {
  try {
    const text = await fsp.readFile(path.join(home, TEST_HOME_ACTIVE_PID_FILE), "utf8");
    const pid = Number.parseInt(text.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function markActiveTestHome(home: string): Promise<void> {
  await fsp.writeFile(path.join(home, TEST_HOME_ACTIVE_PID_FILE), `${process.pid}\n`, "utf8");
}

export function registerStableTestHomeExitCleanup(home: string): void {
  if (stableTestHomeExitCleanup.has(home)) return;
  stableTestHomeExitCleanup.add(home);
  process.once("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {}
  });
}

export async function cleanupStableTestHomesOnce(root: string): Promise<void> {
  if (stableTestHomeRootCleanupOnce) return await stableTestHomeRootCleanupOnce;
  stableTestHomeRootCleanupOnce = cleanupStableTestHomes(root).catch((err) => {
    console.warn(`warning: failed to clean stale test HOME dirs under ${root}:`, err);
  });
  return await stableTestHomeRootCleanupOnce;
}

export async function cleanupStableTestHomes(root: string): Promise<void> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const homes = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("home-"))
    .map((entry) => path.join(root, entry.name));
  const now = Date.now();
  const unmarked: Array<{ path: string; mtimeMs: number }> = [];

  for (const home of homes) {
    const pid = await activeTestHomePid(home);
    if (pid !== null) {
      if (!pidIsAlive(pid)) await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    const stat = await fsp.stat(home).catch(() => null);
    if (!stat?.isDirectory()) continue;
    if (now - stat.mtimeMs >= TEST_HOME_UNMARKED_STALE_MS) {
      await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
    } else {
      unmarked.push({ path: home, mtimeMs: stat.mtimeMs });
    }
  }

  if (unmarked.length <= TEST_HOME_UNMARKED_MAX_COUNT) return;
  unmarked.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const removeCount = unmarked.length - TEST_HOME_UNMARKED_MAX_COUNT;
  for (const stale of unmarked.slice(0, removeCount)) {
    await fsp.rm(stale.path, { recursive: true, force: true }).catch(() => {});
  }
}

export async function stableGoModCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-go-modcache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-go-modcache${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  return root;
}

export async function stableXdgCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-xdg-cache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-xdg-cache${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  return root;
}

export async function stableTestHomeOncePerWorker(): Promise<string> {
  if (stableTestHomeOnce) return await stableTestHomeOnce;
  stableTestHomeOnce = (async () => {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    await markActiveTestHome(home);
    registerStableTestHomeExitCleanup(home);
    return home;
  })();
  return await stableTestHomeOnce;
}

export async function resolveTestHome(): Promise<{ home: string; removeOnExit: boolean }> {
  if (String(process.env.TEST_HOME_PER_TEST || "").trim() === "1") {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    await markActiveTestHome(home);
    return { home, removeOnExit: true };
  }
  const home = await stableTestHomeOncePerWorker();
  return { home, removeOnExit: false };
}
